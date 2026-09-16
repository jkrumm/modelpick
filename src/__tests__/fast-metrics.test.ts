import { describe, it, expect } from "vitest";
import {
  inferUsage,
  reasoningLooksConstant,
  summarizeCell,
  type CallRow,
  type CellResult,
} from "../server/bench/fast-metrics.js";

function row(overrides: Partial<CallRow> = {}): CallRow {
  return {
    taskId: "extract",
    repeat: 1,
    ttfbMs: 100,
    ttftMs: 150,
    thinkMs: 50,
    wallMs: 500,
    visibleTokens: 50,
    reasoningTokens: 10,
    reportedReasoningTokens: 10,
    finishReason: "stop",
    outcomeKind: "pass",
    costUsd: 0.001,
    hasUsage: true,
    ...overrides,
  };
}

function cellResult(rows: CallRow[]): CellResult {
  return { model: "test-model", effort: "default", supported: true, rows };
}

describe("summarizeCell — complete-row medians (defect #1)", () => {
  it("excludes a null-ttft row from every timing median, so wall never computes below ttft", () => {
    const rows = [
      row({ wallMs: 400, ttfbMs: 100, ttftMs: 150 }),
      row({ wallMs: 600, ttfbMs: 120, ttftMs: 200 }),
      // A starved call: a real (short) wall time but no visible content ever
      // arrived — must never enter the wall median, or wall can compute below
      // ttft even though every individual call satisfies wall >= ttft.
      row({
        wallMs: 50,
        ttfbMs: null,
        ttftMs: null,
        outcomeKind: "starved",
        finishReason: "length",
        visibleTokens: 0,
      }),
    ];
    const summary = summarizeCell(cellResult(rows), 1, true);
    expect(summary.timingRows).toBe(2);
    expect(summary.timingRowsTotal).toBe(3);
    expect(summary.medianWallMs).toBe(500); // median of [400, 600] only
    expect(summary.medianTtftMs).toBe(175); // median of [150, 200] only
    expect(summary.medianWallMs).toBeGreaterThanOrEqual(summary.medianTtftMs as number);
  });
});

describe("summarizeCell — decode-rate threshold (defect #2)", () => {
  it("returns null when no call in the cell produced >= 200 visible tokens", () => {
    const rows = [
      row({ visibleTokens: 12, wallMs: 400, ttftMs: 150 }),
      row({ visibleTokens: 40, wallMs: 500, ttftMs: 180 }),
    ];
    const summary = summarizeCell(cellResult(rows), 1, true);
    expect(summary.decodeTokPerSec).toBeNull();
  });

  it("computes decode rate only from calls with >= 200 visible tokens, ignoring short ones", () => {
    const rows = [
      row({ visibleTokens: 12, wallMs: 400, ttftMs: 150 }), // too short — excluded
      row({ visibleTokens: 1000, wallMs: 4150, ttftMs: 150 }), // 1000 tok / 4s = 250 tok/s
    ];
    const summary = summarizeCell(cellResult(rows), 1, true);
    expect(summary.decodeTokPerSec).toBeCloseTo(250, 0);
  });
});

describe("inferUsage — reported-zero fallback (defect #3)", () => {
  it("trusts a nonzero reported value as-is", () => {
    const result = inferUsage({
      promptTokens: 50,
      completionTokens: 629,
      totalTokens: 679,
      reportedReasoningTokens: 314,
      streamedText: "a".repeat(400),
    });
    expect(result.reasoningTokens).toBe(314);
    expect(result.reportedReasoningTokens).toBe(314);
  });

  it("infers reasoning from completion tokens minus streamed text when reported is 0 but the route bills thinking inside completion_tokens (deepseek shape)", () => {
    // total == prompt + completion (shape 1), so the total-gap fallback alone
    // would see 0 — but the model visibly thought a lot for a one-word reply,
    // and reported_reasoning_tokens is 0, so it must not be trusted blindly.
    const result = inferUsage({
      promptTokens: 10,
      completionTokens: 22,
      totalTokens: 32,
      reportedReasoningTokens: 0,
      streamedText: "Yes",
    });
    expect(result.reportedReasoningTokens).toBe(0);
    expect(result.reasoningTokens).toBe(21); // 22 - round(3/4 chars -> 1 token)
    expect(result.visibleTokens).toBe(1);
  });

  it("infers reasoning from the total-tokens gap when the route hides it there (Gemini shape)", () => {
    const result = inferUsage({
      promptTokens: 17,
      completionTokens: 384,
      totalTokens: 1479,
      reportedReasoningTokens: 0,
      streamedText: "x".repeat(4 * 384),
    });
    expect(result.reasoningTokens).toBe(1078); // 1479 - 17 - 384
    expect(result.visibleTokens).toBe(384);
  });
});

describe("reasoningLooksConstant", () => {
  it("flags a nonzero reasoning value fixed across tasks with very different budgets", () => {
    const rows = [
      row({ taskId: "classify", reportedReasoningTokens: 200 }),
      row({ taskId: "longform", reportedReasoningTokens: 200 }),
      row({ taskId: "reason", reportedReasoningTokens: 200 }),
    ];
    expect(reasoningLooksConstant(rows)).toBe(true);
  });

  it("does not flag a value that actually varies with the task", () => {
    const rows = [
      row({ taskId: "classify", reportedReasoningTokens: 12 }),
      row({ taskId: "longform", reportedReasoningTokens: 850 }),
      row({ taskId: "reason", reportedReasoningTokens: 40 }),
    ];
    expect(reasoningLooksConstant(rows)).toBe(false);
  });

  it("does not flag a constant seen on only one task", () => {
    const rows = [
      row({ taskId: "classify", reportedReasoningTokens: 200 }),
      row({ taskId: "classify", reportedReasoningTokens: 200 }),
      row({ taskId: "classify", reportedReasoningTokens: 200 }),
    ];
    expect(reasoningLooksConstant(rows)).toBe(false);
  });
});
