import { gatewayChat, parseResidency, rawFetch } from "./client.js";
import { classifyProbe, isAccessible } from "./classify.js";
import type { Modality, ProbeStatus, Residency } from "../../db/schema.js";

export interface ProbeResult {
  model_id: string;
  modality: Modality;
  accessible: boolean;
  probe_status: ProbeStatus;
  error: string | null;
  latency_ms: number | null;
  residency: Residency;
}

// Working calls on the native gateway take up to ~25s (Claude via Vertex); the
// old 12s cap killed them as false negatives. Give real responses room.
const PROBE_TIMEOUT_MS = 30_000;

const openaiBase = (): string => process.env["IU_OPENAI_BASE_URL"] ?? "";

/** Synthesizes a short spoken clip via a known-good tts alias, reused as the STT
 *  probe fixture. A silent frame yields false negatives — STT needs real audio. */
async function generateReferenceAudio(): Promise<Blob | null> {
  const key = process.env["IU_API_KEY"] ?? "";
  for (const model of ["tts", "tts-hd", "gpt-4o-mini-tts"]) {
    try {
      const resp = await fetch(`${openaiBase()}/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          input: "The quick brown fox jumps over the lazy dog.",
          voice: "alloy",
        }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (resp.status >= 200 && resp.status < 300) {
        const buf = await resp.arrayBuffer();
        if (buf.byteLength > 1000) return new Blob([buf], { type: "audio/mpeg" });
      }
    } catch {
      // try next tts alias
    }
  }
  return null;
}

export interface ProbeOptions {
  model_id: string;
  modality: Modality;
  provider: string;
  audioFixture?: Blob | null;
}

export async function probeModel(opts: ProbeOptions): Promise<ProbeResult> {
  const { model_id, modality, provider } = opts;
  const start = Date.now();
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);

  let status: number | "timeout";
  let body: string;
  let headers: Headers | null;

  if (modality === "llm") {
    const r = await gatewayChat({ model: model_id, provider, prompt: "hi", maxTokens: 4, signal });
    ({ status, body, headers } = r);
  } else if (modality === "embedding") {
    const r = await rawFetch(`${openaiBase()}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model_id, input: "hi" }),
      signal,
    });
    ({ status, body, headers } = r);
  } else if (modality === "tts") {
    const r = await rawFetch(`${openaiBase()}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model_id, input: "hi", voice: "alloy" }),
      signal,
    });
    ({ status, body, headers } = r);
  } else {
    // stt — multipart with REAL audio (filename .mp3; middleware sniffs extension)
    if (!opts.audioFixture) {
      return {
        model_id,
        modality,
        accessible: false,
        probe_status: "unknown",
        error: "no audio fixture available for STT probe",
        latency_ms: null,
        residency: "unknown",
      };
    }
    const form = new FormData();
    form.append("model", model_id);
    form.append("file", opts.audioFixture, "audio.mp3");
    const r = await rawFetch(`${openaiBase()}/audio/transcriptions`, {
      method: "POST",
      body: form,
      signal,
    });
    ({ status, body, headers } = r);
  }

  const latency_ms = Date.now() - start;
  const { status: probe_status, error } = classifyProbe({ status, body });
  const residency = headers ? parseResidency(headers) : "unknown";

  return {
    model_id,
    modality,
    accessible: isAccessible(probe_status),
    probe_status,
    error,
    latency_ms,
    residency,
  };
}

// How many models to probe in parallel. The gateway tolerates this comfortably
// and it keeps a full-catalog probe to a few minutes instead of ~hour.
const PROBE_CONCURRENCY = 8;

/** Runs `worker` over `items` with a fixed concurrency cap, preserving order. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export async function runProbe(): Promise<ProbeResult[]> {
  // Lazy imports keep probeModel() testable without a live DB connection
  const [{ db }, { capabilityProbe, models }, { discoverIuModels }, { canon }] = await Promise.all([
    import("../../db/index.js"),
    import("../../db/schema.js"),
    import("./discover.js"),
    import("../collectors/normalize.js"),
  ]);

  // Merge in the live /v1/models list: it carries the simple working aliases
  // (tts, tts-hd, whisper, lowercase gpt-4o) that the portal export omits. Only
  // add ids whose canonical form isn't already covered, to avoid case/date dupes.
  try {
    const apiModels = await discoverIuModels();
    const existing = await db.select({ id: models.id }).from(models);
    const covered = new Set(existing.map((m) => canon(m.id)));
    const toAdd = apiModels.filter((m) => !covered.has(canon(m.id)));
    if (toAdd.length > 0) {
      await db.insert(models).values(toAdd).onConflictDoNothing();
    }
  } catch (err) {
    console.warn(`[probe] IU /models discovery skipped: ${String(err)}`);
  }

  const catalog = await db
    .select({ model_id: models.id, modality: models.modality, provider: models.provider })
    .from(models);

  // Image models are catalog-only and a real generation call costs money, so we
  // record them as listed without a live probe. Everything else is probed live.
  const toProbe = catalog.filter((c) => c.modality !== "image");
  const imageOnly: ProbeResult[] = catalog
    .filter((c) => c.modality === "image")
    .map((c) => ({
      model_id: c.model_id,
      modality: c.modality,
      accessible: true,
      probe_status: "available" as ProbeStatus,
      error: "listed (image generation not probed)",
      latency_ms: null,
      residency: "unknown" as Residency,
    }));

  // One reference audio clip for the whole run, reused across STT probes.
  const audioFixture = catalog.some((c) => c.modality === "stt")
    ? await generateReferenceAudio()
    : null;

  const probed = await mapPool(toProbe, PROBE_CONCURRENCY, ({ model_id, modality, provider }) =>
    probeModel({ model_id, modality, provider, audioFixture }),
  );

  const results = [...probed, ...imageOnly];

  if (results.length > 0) {
    await db.insert(capabilityProbe).values(
      results.map((r) => ({
        model_id: r.model_id,
        accessible: r.accessible,
        probe_status: r.probe_status,
        error: r.error,
        latency_ms: r.latency_ms,
        residency: r.residency,
      })),
    );
  }

  return results;
}
