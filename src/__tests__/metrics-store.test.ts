import { describe, expect, it, vi } from "vitest";
import { insertMetrics } from "../server/metrics-store.js";
import type { NormalizedMetric } from "../server/collectors/normalize.js";

describe("insertMetrics", () => {
  it("inserts in chunks under SQLite's bound-variable limit and keeps conditions", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: () => ({ values }) } as unknown as Parameters<typeof insertMetrics>[1];
    const metrics: NormalizedMetric[] = Array.from({ length: 1201 }, (_, i) => ({
      model_id: "m",
      source: "epoch",
      metric: "x",
      value: i,
      confidence: 0.85,
      ...(i === 0 ? { conditions: "high" as const } : {}),
    }));
    await insertMetrics(metrics, db);
    const sizes = values.mock.calls.map((c) => (c[0] as unknown[]).length);
    expect(sizes).toEqual([500, 500, 201]);
    expect(Math.max(...sizes) * 6).toBeLessThan(32766);
    expect(values.mock.calls[0]![0][0]).toMatchObject({ conditions: "high" });
    expect(values.mock.calls[0]![0][1]).toMatchObject({ conditions: null });
  });

  it("does nothing for no metrics", async () => {
    const values = vi.fn();
    await insertMetrics([], { insert: () => ({ values }) } as unknown as Parameters<typeof insertMetrics>[1]);
    expect(values).not.toHaveBeenCalled();
  });
});
