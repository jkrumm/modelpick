import { iuFetch, parseResidency, IuFetchError } from "./client.js";
import type { Modality, Residency } from "../../db/schema.js";

export interface ProbeResult {
  model_id: string;
  modality: Modality;
  accessible: boolean;
  latency_ms: number | null;
  residency: Residency;
  error?: string;
}

interface Candidate {
  model_id: string;
  modality: Modality;
}

// Minimal silent MPEG1 Layer3 128kbps 44100Hz joint-stereo frame (417 bytes).
// The STT middleware sniffs the filename extension (.mp3), not the bytes,
// but a valid header avoids format-rejection errors on strict decoders.
function createSilentMp3(): Blob {
  const frame = new Uint8Array(417);
  frame[0] = 0xff;
  frame[1] = 0xfb; // MPEG1, Layer3, no CRC
  frame[2] = 0x90; // 128kbps, 44100Hz, no padding
  frame[3] = 0x64; // joint stereo, no emphasis
  // bytes 4–416 remain 0x00 (silence)
  return new Blob([frame], { type: "audio/mpeg" });
}

export async function probeModel(
  model_id: string,
  modality: Modality,
): Promise<ProbeResult> {
  const start = Date.now();

  try {
    let result: Awaited<ReturnType<typeof iuFetch>>;

    if (modality === "llm") {
      result = await iuFetch("/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model_id,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
      });
    } else if (modality === "tts") {
      result = await iuFetch("/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model_id,
          input: "hi",
          voice: "alloy",
        }),
      });
    } else {
      // stt — multipart/form-data; filename .mp3 is required (middleware sniffs extension)
      const form = new FormData();
      form.append("model", model_id);
      form.append("file", createSilentMp3(), "audio.mp3");
      result = await iuFetch("/audio/transcriptions", {
        method: "POST",
        body: form,
        // No Content-Type: fetch sets multipart boundary automatically
      });
    }

    const latency_ms = Date.now() - start;
    const accessible = result.status >= 200 && result.status < 300;
    const residency = parseResidency(result.headers);

    return { model_id, modality, accessible, latency_ms, residency };
  } catch (err) {
    const latency_ms = Date.now() - start;
    const errorMsg =
      err instanceof IuFetchError
        ? `HTTP ${err.status}`
        : err instanceof Error
          ? err.message
          : "unknown error";

    return {
      model_id,
      modality,
      accessible: false,
      latency_ms,
      residency: "unknown",
      error: errorMsg,
    };
  }
}

export async function runProbe(): Promise<ProbeResult[]> {
  // Lazy imports keep probeModel() testable without a live DB connection
  const [{ db }, { capabilityProbe }, { MODEL_SEED }] = await Promise.all([
    import("../../db/index.js"),
    import("../../db/schema.js"),
    import("../../db/seed.js"),
  ]);

  const candidates: Candidate[] = MODEL_SEED.map((m) => ({
    model_id: m.id,
    modality: m.modality,
  }));

  const results: ProbeResult[] = [];

  for (const { model_id, modality } of candidates) {
    const result = await probeModel(model_id, modality);
    results.push(result);
  }

  // Write results to capability_probe table
  if (results.length > 0) {
    await db.insert(capabilityProbe).values(
      results.map((r) => ({
        model_id: r.model_id,
        accessible: r.accessible,
        latency_ms: r.latency_ms,
        residency: r.residency,
      })),
    );
  }

  return results;
}
