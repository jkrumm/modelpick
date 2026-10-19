import { describe, expect, it } from "vitest";
import {
  buildJudgePrompt,
  DIFF_CHAR_CAP,
  parseVerdicts,
  poolFindings,
  quantile,
  summarizeArm,
  type ArmCell,
  type Finding,
  type Verdict,
} from "../server/bench/review-judge.js";

const f = (message: string): Finding => ({ file: "a.ts", line: 1, message });

function cell(arm: string, blocking: Finding[], extra: Partial<ArmCell> = {}): ArmCell {
  return { arm, status: "done", wallMs: 60_000, outcome: "actionable", blocking, improvements: 2, ...extra };
}

describe("poolFindings", () => {
  it("pools every arm's blocking findings, deterministically, with sequential ids", () => {
    const cells = [cell("a", [f("x"), f("y")]), cell("b", [f("z")])];
    const one = poolFindings(cells, "item1");
    expect(one.map((p) => p.id)).toEqual(["F1", "F2", "F3"]);
    expect(one.map((p) => p.finding.message).sort()).toEqual(["x", "y", "z"]);
    expect(poolFindings(cells, "item1")).toEqual(one);
  });
});

describe("buildJudgePrompt", () => {
  it("never names an arm and caps the diff", () => {
    const pooled = poolFindings([cell("deepseek-v4.1-flash", [f("bug")])], "s");
    const prompt = buildJudgePrompt({ diff: "d".repeat(DIFF_CHAR_CAP + 10), findings: pooled });
    expect(prompt).not.toContain("deepseek");
    expect(prompt).toContain("diff truncated");
    expect(prompt).toContain("### F1");
  });
});

describe("parseVerdicts", () => {
  it("reads JSON around prose and drops unknown ids and verdicts", () => {
    const raw =
      'Here: {"verdicts":[{"id":"F1","verdict":"confirmed_defect"},{"id":"F2","verdict":"maybe"},{"id":"F9","verdict":"not_a_defect"}]}';
    const v = parseVerdicts(raw, ["F1", "F2"]);
    expect([...v.entries()]).toEqual([["F1", "confirmed_defect"]]);
  });

  it("throws when there is no JSON", () => {
    expect(() => parseVerdicts("no", ["F1"])).toThrow();
  });
});

describe("summarizeArm", () => {
  it("counts verdicts, precision, clean rate and failures per arm", () => {
    const real = f("real");
    const nit = f("nit");
    const cells = [
      cell("a", [real, nit], { wallMs: 100 }),
      cell("a", [], { outcome: "clean", wallMs: 300 }),
      cell("a", [], { status: "failed" }),
      cell("b", [f("other")]),
    ];
    const verdicts = new Map<Finding, Verdict>([
      [real, "confirmed_defect"],
      [nit, "not_blocking"],
    ]);
    const s = summarizeArm("a", cells, verdicts);
    expect(s).toMatchObject({ reviews: 2, failed: 1, blocking: 2, cleanRate: 0.5, blockingPrecision: 0.5 });
    expect(s.verdicts).toMatchObject({ confirmed_defect: 1, not_blocking: 1, unjudged: 0 });
    expect(s.p50WallMs).toBe(300);
  });

  it("reports no precision when nothing was judged", () => {
    expect(summarizeArm("a", [cell("a", [f("x")])], new Map()).blockingPrecision).toBeNull();
  });
});

describe("quantile", () => {
  it("returns null on empty input", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([1, 2, 3], 0.5)).toBe(2);
  });
});
