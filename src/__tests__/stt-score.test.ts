import { describe, expect, it } from "vitest";
import { alignHyp, normalizeText, rawTokens, speakerAccuracy, wer } from "~/server/audio/stt-score";

describe("normalizeText", () => {
  it("drops case, punctuation and quotes; hyphens split", () => {
    expect(normalizeText("Ringer-Kollegen zollten „Luna“ Tribut.")).toEqual(["ringer", "kollegen", "zollten", "luna", "tribut"]);
  });
});

describe("wer", () => {
  it("counts substitutions, deletions and insertions", () => {
    expect(wer(["a", "b", "c", "d"], ["a", "x", "c"]).errors).toBe(2);
    expect(wer(["a", "b"], ["a", "b"]).wer).toBe(0);
  });
  it("raw tokens penalise attached punctuation and casing", () => {
    expect(wer(rawTokens("Hallo Welt."), rawTokens("hallo Welt")).errors).toBe(2);
  });
  it("windowed ignores reference text outside the recording", () => {
    const ref = "x y a b c d e f z".split(" ");
    const r = wer(ref, "a b c d e f".split(" "), true);
    expect(r.errors).toBe(0);
    expect(r.refWords).toBe(6);
  });
  it("empty hypothesis is a full miss", () => {
    expect(wer(["a", "b"], []).wer).toBe(1);
  });
});

describe("speakerAccuracy", () => {
  const turns = [
    { speaker: "Mark", text: "guten tag zusammen" },
    { speaker: "Sarah", text: "hallo und willkommen" },
  ];
  it("is invariant to label naming", () => {
    expect(speakerAccuracy(turns, [{ speaker: "A", text: "guten tag zusammen" }, { speaker: "B", text: "hallo und willkommen" }])).toBe(1);
  });
  it("drops when one label covers everything", () => {
    expect(speakerAccuracy(turns, [{ speaker: "A", text: "guten tag zusammen hallo und willkommen" }])).toBe(0.5);
  });
  it("aligns around a dropped word", () => {
    expect(alignHyp(["a", "b", "c"], ["a", "c"])).toEqual([0, 2]);
  });
});

describe("wer edge cases", () => {
  it("counts an inserted word", () => {
    expect(wer(["a", "b"], ["a", "x", "b"]).errors).toBe(1);
  });
  it("reports the scored window", () => {
    const r = wer("p q a b c r".split(" "), "a x c".split(" "), true);
    expect([r.refStart, r.refEnd, r.errors]).toEqual([2, 5, 1]);
  });
});

describe("speakerAccuracy mapping", () => {
  const turns = [
    { speaker: "A", text: "eins zwei drei vier fünf" },
    { speaker: "B", text: "sechs sieben acht neun" },
  ];
  it("uses the best one-to-one mapping, not the greedy one", () => {
    // greedy pairs h1→A (3) and leaves h2 nothing = 3/9; the best mapping is h1→B (4) + h2→A (2) = 6/9
    const segs = [
      { speaker: "h1", text: "eins zwei drei sechs sieben acht neun" },
      { speaker: "h2", text: "vier fünf" },
    ];
    expect(speakerAccuracy(turns, segs)).toBeCloseTo(6 / 9);
  });
  it("is null when nothing matches", () => {
    expect(speakerAccuracy(turns, [{ speaker: "x", text: "zzz" }])).toBeNull();
  });
});
