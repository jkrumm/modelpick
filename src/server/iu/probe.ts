import { eq, inArray } from "drizzle-orm";
import { dialectForProvider, gatewayChat, parseResidency, rawFetch } from "./client.js";
import { classifyProbe, isAccessible } from "./classify.js";
import { probeReplicate } from "./replicate.js";
import type {
  Modality,
  ModelInsert,
  ProbeStatus,
  Residency,
  Transport,
  models as ModelsTable,
  capabilityProbe as CapabilityProbeTable,
  metricSnapshot as MetricSnapshotTable,
  recommendation as RecommendationTable,
  stackChoice as StackChoiceTable,
  demo as DemoTable,
} from "../../db/schema.js";
// Type-only — mirrors the lazy value import of `db` inside runProbe() below, so
// importing this type never opens a live DB connection at module load.
import type { db as DbHandle } from "../../db/index.js";
type DbClient = typeof DbHandle;

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
const geminiBase = (): string => process.env["IU_GEMINI_BASE_URL"] ?? "";

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
  // Optional so existing IU-native callers/tests are unaffected; runProbe always
  // threads the catalog row's real transport through.
  transport?: Transport;
  audioFixture?: Blob | null;
  audioDataUri?: string | null;
}

export async function probeModel(opts: ProbeOptions): Promise<ProbeResult> {
  const { model_id, modality, provider, transport = "iu" } = opts;
  const start = Date.now();
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);

  let status: number | "timeout";
  let body: string;
  let headers: Headers | null;

  if (transport === "replicate") {
    // Replicate's route only serves speech models; stt additionally needs a
    // real audio fixture as a data URI (the gateway takes a URL, not multipart).
    if (modality === "stt" && !opts.audioDataUri) {
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
    const r = await probeReplicate({ model_id, modality, audioDataUri: opts.audioDataUri ?? null });
    status = r.status;
    body = r.body;
    // The gateway's Replicate route returns no region header — residency stays
    // unknown, so there's no headers object to parse.
    headers = null;
  } else if (modality === "llm") {
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
    // Gemini TTS isn't served on the OpenAI-compat /audio/speech route — it only
    // answers on the native generateContent endpoint with an AUDIO response
    // modality. Everything else (OpenAI, Mistral voxtral) uses /audio/speech.
    if (dialectForProvider(provider) === "gemini") {
      const r = await rawFetch(`${geminiBase()}/models/${model_id}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "hi" }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
          },
        }),
        signal,
      });
      ({ status, body, headers } = r);
    } else {
      const r = await rawFetch(`${openaiBase()}/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model_id, input: "hi", voice: "alloy" }),
        signal,
      });
      ({ status, body, headers } = r);
    }
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

// ── Case-duplicate reconciliation ──────────────────────────────────────────
// The portal export and the live /models endpoint disagree on casing for the
// same route (`GPT-5.5` vs `gpt-5.5`) — the live id is the only one that's
// actually callable, and metric/recommendation writes split across the two
// rows depending on whether they came from a live probe or a leaderboard
// collector's id resolver. Fold the loser into the survivor before anything
// else reads the catalog.

export interface CaseDuplicatePair {
  loserId: string;
  survivorId: string;
}

/** Groups model ids by lowercase form and, for each group with more than one
 *  case variant, resolves the survivor as the id the live /v1/models response
 *  actually returned. A group where neither or multiple variants are live is
 *  left untouched — guessing which one is real is exactly the mistake this
 *  is fixing. */
/**
 * The part of an id that identifies the route, lowercased with any `vendor/`
 * prefix removed. `MiniMaxAI/MiniMax-M3` and `minimax-m3` are the same model
 * reached two ways — the portal export writes the HuggingFace-style path, the
 * live endpoint serves the bare id — and leaving both meant collectors split
 * their metrics across two rows: Epoch landed 24 values on the prefixed id and
 * zero on the one we actually call.
 *
 * Deliberately narrow. It strips the prefix and casing and NOTHING else, so a
 * genuinely different serving tier keeps its own row: `MiniMax-M2.5-fast` does
 * not collapse into `MiniMax-M2.5`, nor `Qwen3-32B-fast` into `Qwen3-32B`.
 * `canon()` would flatten those too — it treats `fast` as noise, which is right
 * for matching a leaderboard name and wrong for deciding a route exists.
 */
function routeKey(id: string): string {
  const bare = id.includes("/") ? (id.split("/").pop() ?? id) : id;
  return bare.toLowerCase();
}

/**
 * Ordering for "which live id do we keep". Bare beats vendor-prefixed, lowercase
 * beats mixed case, then lexicographic. Every step is a total order, so the
 * survivor never depends on the row order the catalog happened to return —
 * a fold that picks a different winner on a re-run would shuffle metrics
 * between two ids forever.
 */
function preferBareLowercase(a: string, b: string): number {
  const bare = Number(a.includes("/")) - Number(b.includes("/"));
  if (bare !== 0) return bare;
  const lower = Number(a !== a.toLowerCase()) - Number(b !== b.toLowerCase());
  if (lower !== 0) return lower;
  return a.localeCompare(b);
}

export function findCaseDuplicatePairs({
  modelIds,
  liveIds,
}: {
  modelIds: string[];
  liveIds: Set<string>;
}): CaseDuplicatePair[] {
  const byLower = new Map<string, string[]>();
  for (const id of modelIds) {
    const key = routeKey(id);
    const group = byLower.get(key);
    if (group) {
      group.push(id);
    } else {
      byLower.set(key, [id]);
    }
  }

  const pairs: CaseDuplicatePair[] = [];
  for (const variants of byLower.values()) {
    if (variants.length < 2) continue;
    const liveVariants = variants.filter((id) => liveIds.has(id));
    if (liveVariants.length === 0) continue; // nothing live — nothing to prefer, don't guess
    // IU really does serve both forms of some ids (`minimax-m3` AND
    // `MiniMaxAI/MiniMax-M3`, `Qwen3.5-397B-A17B` AND `Qwen/Qwen3.5-397B-A17B`),
    // so "exactly one is live" is not a usable rule on its own. When several are,
    // keep the bare form: it is the short id every script, probe and rate card
    // already writes under, so folding toward it moves the fewest rows and leaves
    // the catalog agreeing with what we actually call.
    const survivorId = [...liveVariants].sort(preferBareLowercase)[0] as string;
    for (const loserId of variants) {
      if (loserId !== survivorId) pairs.push({ loserId, survivorId });
    }
  }
  return pairs;
}

/** Plans which of a child table's rows should move from loser to survivor, and
 *  which would collide with a row the survivor already holds (same content key
 *  under a different model_id) and so should be dropped instead of moved. Pure
 *  planning over already-fetched rows — this is what makes the fold testable
 *  without a live DB. */
export function planTableReconciliation<Row extends { id: number; model_id: string }>({
  loserId,
  survivorId,
  rows,
  uniqueKey,
}: {
  loserId: string;
  survivorId: string;
  rows: Row[];
  uniqueKey: (row: Row) => string;
}): { repoint: number[]; dropAsCollision: number[] } {
  const survivorKeys = new Set(
    rows.filter((r) => r.model_id === survivorId).map((r) => uniqueKey(r)),
  );
  const repoint: number[] = [];
  const dropAsCollision: number[] = [];
  for (const row of rows) {
    if (row.model_id !== loserId) continue;
    const key = uniqueKey(row);
    if (survivorKeys.has(key)) {
      dropAsCollision.push(row.id);
    } else {
      repoint.push(row.id);
      survivorKeys.add(key); // two loser rows can't both repoint onto the same key either
    }
  }
  return { repoint, dropAsCollision };
}

/** Applies a plan to one child table and returns how many rows moved (repointed
 *  or dropped as a collision). `update`/`del` close over the concrete table so
 *  this stays a thin count-and-apply wrapper rather than a generic Drizzle
 *  table abstraction. */
async function applyReconciliationPlan({
  plan,
  update,
  del,
}: {
  plan: { repoint: number[]; dropAsCollision: number[] };
  update: (ids: number[]) => Promise<unknown>;
  del: (ids: number[]) => Promise<unknown>;
}): Promise<number> {
  if (plan.dropAsCollision.length > 0) await del(plan.dropAsCollision);
  if (plan.repoint.length > 0) await update(plan.repoint);
  return plan.repoint.length + plan.dropAsCollision.length;
}

export interface CaseDuplicateTables {
  models: typeof ModelsTable;
  capabilityProbe: typeof CapabilityProbeTable;
  metricSnapshot: typeof MetricSnapshotTable;
  recommendation: typeof RecommendationTable;
  stackChoice: typeof StackChoiceTable;
  demo: typeof DemoTable;
}

/** Folds every case-duplicate pair currently in `models` into the live-id
 *  survivor, re-pointing every table with an FK onto `models.id`
 *  (capability_probe, metric_snapshot, recommendation, stack_choice, demo,
 *  news_item — found by grepping schema.ts for `models.id` references;
 *  pick_probe and bench_run store model_id but are deliberately NOT FKs, per
 *  their own schema comments, so they're out of scope here) before deleting
 *  the loser row. Re-pointing before deleting matters: the FK is
 *  onDelete: cascade, so deleting the loser first would wipe its children
 *  instead of preserving them under the survivor. */
export async function reconcileCaseDuplicates({
  db,
  tables,
  liveIds,
}: {
  db: DbClient;
  tables: CaseDuplicateTables;
  liveIds: Set<string>;
}): Promise<void> {
  const { models, capabilityProbe, metricSnapshot, recommendation, stackChoice, demo } =
    tables;

  const modelIds = (await db.select({ id: models.id }).from(models)).map((m) => m.id);
  const pairs = findCaseDuplicatePairs({ modelIds, liveIds });

  for (const pair of pairs) {
    const { loserId, survivorId } = pair;
    let moved = 0;

    const capabilityRows = await db
      .select({
        id: capabilityProbe.id,
        model_id: capabilityProbe.model_id,
        checked_at: capabilityProbe.checked_at,
      })
      .from(capabilityProbe);
    moved += await applyReconciliationPlan({
      plan: planTableReconciliation({
        loserId,
        survivorId,
        rows: capabilityRows,
        uniqueKey: (r) => r.checked_at,
      }),
      update: (ids) =>
        db
          .update(capabilityProbe)
          .set({ model_id: survivorId })
          .where(inArray(capabilityProbe.id, ids)),
      del: (ids) => db.delete(capabilityProbe).where(inArray(capabilityProbe.id, ids)),
    });

    const metricRows = await db
      .select({
        id: metricSnapshot.id,
        model_id: metricSnapshot.model_id,
        source: metricSnapshot.source,
        metric: metricSnapshot.metric,
        captured_at: metricSnapshot.captured_at,
      })
      .from(metricSnapshot);
    moved += await applyReconciliationPlan({
      plan: planTableReconciliation({
        loserId,
        survivorId,
        rows: metricRows,
        uniqueKey: (r) => `${r.source}|${r.metric}|${r.captured_at}`,
      }),
      update: (ids) =>
        db.update(metricSnapshot).set({ model_id: survivorId }).where(inArray(metricSnapshot.id, ids)),
      del: (ids) => db.delete(metricSnapshot).where(inArray(metricSnapshot.id, ids)),
    });

    const recommendationRows = await db
      .select({
        id: recommendation.id,
        model_id: recommendation.model_id,
        category: recommendation.category,
        snapshot_date: recommendation.snapshot_date,
      })
      .from(recommendation);
    moved += await applyReconciliationPlan({
      plan: planTableReconciliation({
        loserId,
        survivorId,
        rows: recommendationRows,
        uniqueKey: (r) => `${r.category}|${r.snapshot_date}`,
      }),
      update: (ids) =>
        db
          .update(recommendation)
          .set({ model_id: survivorId })
          .where(inArray(recommendation.id, ids)),
      del: (ids) => db.delete(recommendation).where(inArray(recommendation.id, ids)),
    });

    const stackRows = await db
      .select({ id: stackChoice.id, model_id: stackChoice.model_id, category: stackChoice.category })
      .from(stackChoice);
    moved += await applyReconciliationPlan({
      plan: planTableReconciliation({
        loserId,
        survivorId,
        rows: stackRows,
        uniqueKey: (r) => r.category,
      }),
      update: (ids) =>
        db.update(stackChoice).set({ model_id: survivorId }).where(inArray(stackChoice.id, ids)),
      del: (ids) => db.delete(stackChoice).where(inArray(stackChoice.id, ids)),
    });

    const demoRows = await db
      .select({
        id: demo.id,
        model_id: demo.model_id,
        modality: demo.modality,
        text_content: demo.text_content,
        lang: demo.lang,
        preset: demo.preset,
        voice: demo.voice,
      })
      .from(demo);
    moved += await applyReconciliationPlan({
      plan: planTableReconciliation({
        loserId,
        survivorId,
        rows: demoRows,
        uniqueKey: (r) => `${r.modality}|${r.text_content}|${r.lang}|${r.preset ?? ""}|${r.voice ?? ""}`,
      }),
      update: (ids) => db.update(demo).set({ model_id: survivorId }).where(inArray(demo.id, ids)),
      del: (ids) => db.delete(demo).where(inArray(demo.id, ids)),
    });

    await db.delete(models).where(eq(models.id, loserId));

    console.warn(
      `[probe] case-duplicate fold: "${loserId}" -> "${survivorId}" (${moved} child row${moved === 1 ? "" : "s"} moved)`,
    );
  }
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
  const [
    { db },
    { capabilityProbe, metricSnapshot, recommendation, stackChoice, demo, models },
    { discoverIuModels },
  ] = await Promise.all([
    import("../../db/index.js"),
    import("../../db/schema.js"),
    import("./discover.js"),
  ]);

  // Merge in the live /v1/models list: it carries the simple working aliases
  // (tts, tts-hd, whisper, lowercase gpt-4o) that the portal export omits, and it
  // is the only source that stays current between portal exports.
  //
  // Dedupe on the EXACT id, not `canon()`. canon() exists to match a leaderboard's
  // name to a catalog entry, and to do that it strips `eu`, `fast` and friends as
  // noise — which is right there and wrong here: `gemini-3.5-flash-eu` is a
  // physically different, EU-deployed route from `gemini-3.5-flash`, and collapsing
  // them meant every `-eu` alias and every live id whose casing drifted from the
  // portal export never got a `models` row at all. Everything keyed on those ids
  // then failed the foreign key on write, silently, which is how the catalog went
  // stale while the probe reported success. A cosmetic `GLM-5.3` / `glm-5.3` pair
  // is a far cheaper problem than an unaddressable route.
  let apiModels: ModelInsert[] = [];
  try {
    apiModels = await discoverIuModels();
    const existing = await db.select({ id: models.id }).from(models);
    const covered = new Set(existing.map((m) => m.id));
    const toAdd = apiModels.filter((m) => !covered.has(m.id));
    if (toAdd.length > 0) {
      await db.insert(models).values(toAdd).onConflictDoNothing();
    }
  } catch (err) {
    console.warn(`[probe] IU /models discovery skipped: ${String(err)}`);
  }

  // Fold the case-duplicate rows the merge above exposed (see the block comment
  // near reconcileCaseDuplicates for why). Discovery failing above leaves
  // apiModels empty, which makes every pair's "which id is live" check
  // inconclusive — findCaseDuplicatePairs correctly skips all of them rather
  // than guessing, so this stays safe with no live data.
  try {
    await reconcileCaseDuplicates({
      db,
      tables: { models, capabilityProbe, metricSnapshot, recommendation, stackChoice, demo },
      liveIds: new Set(apiModels.map((m) => m.id)),
    });
  } catch (err) {
    console.warn(`[probe] case-duplicate reconciliation skipped: ${String(err)}`);
  }

  const catalog = await db
    .select({
      model_id: models.id,
      modality: models.modality,
      provider: models.provider,
      transport: models.transport,
    })
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
  // Replicate's route takes a URL or a data URI for audio input, not multipart —
  // and Replicate's own hosted URLs expire within minutes, so a data URI is the
  // only stable fixture. Converted once and reused across Replicate STT probes.
  const audioDataUri =
    audioFixture && catalog.some((c) => c.modality === "stt" && c.transport === "replicate")
      ? `data:audio/mpeg;base64,${Buffer.from(await audioFixture.arrayBuffer()).toString("base64")}`
      : null;

  const probed = await mapPool(
    toProbe,
    PROBE_CONCURRENCY,
    ({ model_id, modality, provider, transport }) =>
      probeModel({ model_id, modality, provider, transport, audioFixture, audioDataUri }),
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
