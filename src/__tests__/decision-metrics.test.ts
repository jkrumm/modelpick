import { describe, it, expect } from "vitest";
import {
  DECISION_METRIC,
  isUnreliable,
  median,
  metricsOf,
  rankDecisionRows,
  rowFromMetrics,
  summarizeModel,
  suiteMetricName,
  type DecisionCallRecord,
  type DecisionRow,
} from "../server/bench/decision-metrics.js";
import type { QuestionGrade } from "../server/bench/decision-tasks.js";

function grade(outcome: QuestionGrade["outcome"], brier: number | null = null): QuestionGrade {
  return { question: "q", type: "boolean", outcome, brier, expectedProbability: null };
}

function call(
  over: Partial<DecisionCallRecord> & { grades?: QuestionGrade[] },
): DecisionCallRecord {
  return {
    model: "m",
    task: "t1",
    caseId: "c1",
    repeat: 1,
    wallMs: 100,
    costUsd: 0.0001,
    costEstimated: false,
    error: null,
    grades: [grade("correct", 0.01)],
    ...over,
  };
}

describe("median", () => {
  it("handles odd, even and empty input", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("summarizeModel", () => {
  it("counts errored calls separately and leaves them out of accuracy and latency", () => {
    const s = summarizeModel("m", [
      call({ wallMs: 100 }),
      call({ wallMs: 300, repeat: 2 }),
      call({ wallMs: 120_000, repeat: 3, error: "timeout", grades: [], costUsd: null }),
    ]);
    expect(s.calls).toBe(3);
    expect(s.errorCalls).toBe(1);
    expect(s.errorRate).toBeCloseTo(1 / 3);
    expect(s.accuracy).toBe(1);
    expect(s.latencyP50Ms).toBe(200);
  });

  it("excludes refusals from the accuracy denominator and reports a refusal rate", () => {
    const s = summarizeModel("m", [
      call({ grades: [grade("correct"), grade("wrong"), grade("refused")] }),
    ]);
    expect(s.accuracy).toBe(0.5);
    expect(s.refusalRate).toBeCloseTo(1 / 3);
  });

  it("macro-averages suite accuracy so a large suite does not outvote a small one", () => {
    const big = Array.from({ length: 9 }, (_, i) =>
      call({ task: "big", caseId: `b${i}`, grades: [grade("correct")] }),
    );
    const small = call({ task: "small", caseId: "s1", grades: [grade("wrong")] });
    const s = summarizeModel("m", [...big, small]);
    expect(s.accuracy).toBe(0.5); // (1 + 0) / 2, not 9/10
    expect(s.suites.map((x) => [x.task, x.accuracy])).toEqual([
      ["big", 1],
      ["small", 0],
    ]);
  });

  it("averages Brier over graded questions that carried probabilities only", () => {
    const s = summarizeModel("m", [
      call({ grades: [grade("correct", 0.02), grade("correct", 0.06), grade("correct", null)] }),
    ]);
    expect(s.brier).toBeCloseTo(0.04);
  });

  it("scales mean per-call cost to 1,000 calls and flags an estimate", () => {
    const s = summarizeModel("m", [
      call({ costUsd: 0.0001, costEstimated: true }),
      call({ costUsd: 0.0003, costEstimated: true, repeat: 2 }),
    ]);
    expect(s.costPer1kCallsUsd).toBeCloseTo(0.2);
    expect(s.costEstimated).toBe(true);
  });

  it("reports no cost when no call carried one", () => {
    expect(summarizeModel("m", [call({ costUsd: null })]).costPer1kCallsUsd).toBeNull();
  });

  it("counts cases whose outcome differs between repeats as unstable", () => {
    const s = summarizeModel("m", [
      call({ caseId: "flaky", repeat: 1, grades: [grade("correct")] }),
      call({ caseId: "flaky", repeat: 2, grades: [grade("wrong")] }),
      call({ caseId: "steady", repeat: 1, grades: [grade("correct")] }),
      call({ caseId: "steady", repeat: 2, grades: [grade("correct")] }),
    ]);
    expect(s.unstableCases).toBe(1);
  });

  it("ignores other models' records", () => {
    const s = summarizeModel("m", [call({}), call({ model: "other", grades: [grade("wrong")] })]);
    expect(s.calls).toBe(1);
    expect(s.accuracy).toBe(1);
  });
});

describe("persisted metrics", () => {
  const summary = summarizeModel("m", [call({ task: "contact-form-verdict" })]);

  it("round-trips through metric names back into a row", () => {
    const map = new Map(metricsOf(summary, true).map((p) => [p.metric, p.value]));
    const row = rowFromMetrics("m", map);
    expect(row.accuracy).toBe(1);
    expect(row.latencyP50Ms).toBe(100);
    expect(row.errorRate).toBe(0);
    expect(row.suiteAccuracy).toEqual({ "contact-form-verdict": 1 });
  });

  it("writes only per-suite accuracy for a partial run", () => {
    const names = metricsOf(summary, false).map((p) => p.metric);
    expect(names).toEqual([suiteMetricName("contact-form-verdict")]);
  });

  it("omits a metric it could not measure", () => {
    const empty = summarizeModel("m", [call({ error: "boom", grades: [], costUsd: null })]);
    const names = metricsOf(empty, true).map((p) => p.metric);
    expect(names).not.toContain(DECISION_METRIC.accuracy);
    expect(names).toContain(DECISION_METRIC.errorRate);
  });
});

function row(model: string, over: Partial<DecisionRow>): DecisionRow {
  return {
    model,
    accuracy: 1,
    brier: 0.05,
    latencyP50Ms: 200,
    costPer1kCallsUsd: 0.1,
    errorRate: 0,
    refusalRate: 0,
    suiteAccuracy: {},
    ...over,
  };
}

describe("rankDecisionRows", () => {
  it("orders by accuracy, then Brier, then latency", () => {
    const ranked = rankDecisionRows([
      row("slow", { latencyP50Ms: 400 }),
      row("fast", { latencyP50Ms: 100 }),
      row("sharp", { brier: 0.01, latencyP50Ms: 900 }),
      row("worse", { accuracy: 0.9 }),
    ]);
    expect(ranked.map((r) => r.model)).toEqual(["sharp", "fast", "slow", "worse"]);
  });

  it("sinks an unreliable model below every reliable one, however accurate", () => {
    const ranked = rankDecisionRows([
      row("flaky", { accuracy: 1, errorRate: 0.3 }),
      row("steady", { accuracy: 0.8 }),
    ]);
    expect(ranked.map((r) => r.model)).toEqual(["steady", "flaky"]);
    expect(isUnreliable({ errorRate: 0.3 })).toBe(true);
    expect(isUnreliable({ errorRate: null })).toBe(false);
  });

  it("puts a model with no accuracy last", () => {
    const ranked = rankDecisionRows([
      row("none", { accuracy: null }),
      row("some", { accuracy: 0.5 }),
    ]);
    expect(ranked.map((r) => r.model)).toEqual(["some", "none"]);
  });
});
