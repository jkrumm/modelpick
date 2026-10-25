import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCoverage, readSttResults, type SttResult } from "~/server/audio/stt-compare";

const row = (model: string, win: number, refWords: number): SttResult => ({
  clip: "long", model, where: "iu", ok: true, hypothesis: "x", latency_ms: 1, audio_s: 720, rtf: 0.01,
  wer_norm: win, wer_raw: win, ref_words: refWords, hyp_words: refWords,
  window_wer_norm: win, window_wer_raw: win, window_ref_words: refWords,
});

describe("applyCoverage", () => {
  it("charges the uncovered reference tail as deletions", () => {
    const [full, short] = applyCoverage([row("full", 0.06, 1800), row("short", 0.05, 1200)]);
    expect(full!.wer_norm).toBeCloseTo(0.06);
    expect(short!.coverage).toBeCloseTo(1200 / 1800);
    expect(short!.wer_norm).toBeCloseTo((0.05 * 1200 + 600) / 1800);
  });
  it("is idempotent", () => {
    const once = applyCoverage([row("full", 0.06, 1800), row("short", 0.05, 1200)]);
    expect(applyCoverage(once)).toEqual(once);
  });
  it("leaves non-windowed rows alone", () => {
    const plain: SttResult = { ...row("m", 0.1, 20), clip: "short" };
    delete plain.window_ref_words;
    expect(applyCoverage([plain])[0]).toEqual(plain);
  });
});

describe("readSttResults", () => {
  const prev = process.env["STT_COMPARE_DIR"];
  afterEach(() => {
    if (prev === undefined) delete process.env["STT_COMPARE_DIR"];
    else process.env["STT_COMPARE_DIR"] = prev;
  });
  it("returns an empty default only when the file is missing", async () => {
    process.env["STT_COMPARE_DIR"] = await mkdtemp(join(tmpdir(), "stt-"));
    expect((await readSttResults()).results).toEqual([]);
  });
  it("throws on a corrupt file instead of pretending there is no data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stt-"));
    await writeFile(join(dir, "results.json"), "{ truncated");
    process.env["STT_COMPARE_DIR"] = dir;
    await expect(readSttResults()).rejects.toThrow();
  });
});
