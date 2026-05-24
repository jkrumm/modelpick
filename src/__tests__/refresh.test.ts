import { describe, it, expect, vi } from "vitest";
import { runRefresh } from "../server/refresh.js";
import type { RefreshDeps } from "../server/refresh.js";

const baseMetric = {
  model_id: "m1",
  source: "openrouter" as const,
  metric: "quality",
  value: 0.8,
  confidence: 1,
};

const makeDeps = (overrides: Partial<RefreshDeps> = {}): RefreshDeps => ({
  probe: vi.fn().mockResolvedValue([{ accessible: true }, { accessible: false }]),
  collectOpenRouter: vi.fn().mockResolvedValue({ metrics: [baseMetric], unmatched: [] }),
  collectArtificialAnalysis: vi.fn().mockResolvedValue({ metrics: [], unmatched: [] }),
  insertMetrics: vi.fn().mockResolvedValue(undefined),
  runRecommender: vi.fn().mockResolvedValue(undefined),
  collectNews: vi.fn().mockResolvedValue({ inserted: 3 }),
  ...overrides,
});

describe("runRefresh", () => {
  it("calls all four steps and returns allOk=true when all succeed", async () => {
    const deps = makeDeps();
    const result = await runRefresh(deps);

    expect(deps.probe).toHaveBeenCalledOnce();
    expect(deps.collectOpenRouter).toHaveBeenCalledOnce();
    expect(deps.collectArtificialAnalysis).toHaveBeenCalledOnce();
    expect(deps.insertMetrics).toHaveBeenCalledOnce();
    expect(deps.runRecommender).toHaveBeenCalledOnce();
    expect(deps.collectNews).toHaveBeenCalledOnce();
    expect(result.allOk).toBe(true);
  });

  it("continues all remaining steps when probe fails", async () => {
    const deps = makeDeps({
      probe: vi.fn().mockRejectedValue(new Error("probe timeout")),
    });
    const result = await runRefresh(deps);

    expect(result.probe.ok).toBe(false);
    expect(result.collect.ok).toBe(true);
    expect(result.recommend.ok).toBe(true);
    expect(result.news.ok).toBe(true);
    expect(result.allOk).toBe(false);
    // Subsequent steps still ran
    expect(deps.runRecommender).toHaveBeenCalledOnce();
    expect(deps.collectNews).toHaveBeenCalledOnce();
  });

  it("continues when recommend fails", async () => {
    const deps = makeDeps({
      runRecommender: vi.fn().mockRejectedValue(new Error("recommend error")),
    });
    const result = await runRefresh(deps);

    expect(result.probe.ok).toBe(true);
    expect(result.collect.ok).toBe(true);
    expect(result.recommend.ok).toBe(false);
    expect(result.news.ok).toBe(true);
    expect(result.allOk).toBe(false);
    expect(deps.collectNews).toHaveBeenCalledOnce();
  });

  it("continues when news fails", async () => {
    const deps = makeDeps({
      collectNews: vi.fn().mockRejectedValue(new Error("news error")),
    });
    const result = await runRefresh(deps);

    expect(result.probe.ok).toBe(true);
    expect(result.collect.ok).toBe(true);
    expect(result.recommend.ok).toBe(true);
    expect(result.news.ok).toBe(false);
    expect(result.allOk).toBe(false);
  });

  it("collect step handles partial collector failure via allSettled", async () => {
    // OR throws but AA succeeds — collect step itself stays ok
    const deps = makeDeps({
      collectOpenRouter: vi.fn().mockRejectedValue(new Error("OR timeout")),
      collectArtificialAnalysis: vi.fn().mockResolvedValue({
        metrics: [baseMetric],
        unmatched: [],
      }),
    });
    const result = await runRefresh(deps);

    // collect step is still ok because allSettled catches OR failure
    expect(result.collect.ok).toBe(true);
    expect(result.allOk).toBe(true);
    // insertMetrics called with AA metrics only
    expect(deps.insertMetrics).toHaveBeenCalledWith([baseMetric]);
  });

  it("marks collect failed when insertMetrics throws", async () => {
    const deps = makeDeps({
      insertMetrics: vi.fn().mockRejectedValue(new Error("DB error")),
    });
    const result = await runRefresh(deps);

    expect(result.collect.ok).toBe(false);
    expect(result.probe.ok).toBe(true);
    expect(result.recommend.ok).toBe(true);
    expect(result.news.ok).toBe(true);
    expect(result.allOk).toBe(false);
  });

  it("skips insertMetrics when no metrics are collected", async () => {
    const deps = makeDeps({
      collectOpenRouter: vi.fn().mockResolvedValue({ metrics: [], unmatched: [] }),
      collectArtificialAnalysis: vi.fn().mockResolvedValue({ metrics: [], unmatched: [] }),
    });
    const result = await runRefresh(deps);

    expect(deps.insertMetrics).not.toHaveBeenCalled();
    expect(result.collect.ok).toBe(true);
    expect(result.allOk).toBe(true);
  });

  it("probe message includes accessible/total count", async () => {
    const deps = makeDeps({
      probe: vi.fn().mockResolvedValue([
        { accessible: true },
        { accessible: true },
        { accessible: false },
      ]),
    });
    const result = await runRefresh(deps);

    expect(result.probe.message).toContain("2/3");
  });

  it("news message includes inserted count", async () => {
    const deps = makeDeps({
      collectNews: vi.fn().mockResolvedValue({ inserted: 7 }),
    });
    const result = await runRefresh(deps);

    expect(result.news.message).toContain("7");
  });

  it("allOk false when multiple steps fail", async () => {
    const deps = makeDeps({
      probe: vi.fn().mockRejectedValue(new Error("probe error")),
      runRecommender: vi.fn().mockRejectedValue(new Error("recommend error")),
    });
    const result = await runRefresh(deps);

    expect(result.probe.ok).toBe(false);
    expect(result.collect.ok).toBe(true);
    expect(result.recommend.ok).toBe(false);
    expect(result.news.ok).toBe(true);
    expect(result.allOk).toBe(false);
  });
});
