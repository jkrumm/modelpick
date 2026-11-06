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
  syncCatalog: vi.fn().mockResolvedValue({ total: 3, added: ["a"], removed: [] }),
  probe: vi.fn().mockResolvedValue([{ accessible: true }, { accessible: false }]),
  collectOpenRouter: vi.fn().mockResolvedValue({ metrics: [baseMetric], unmatched: [] }),
  collectArtificialAnalysis: vi.fn().mockResolvedValue({ metrics: [baseMetric], unmatched: [] }),
  collectEpoch: vi.fn().mockResolvedValue({ metrics: [baseMetric], unmatched: [] }),
  collectAaSpeech: vi.fn().mockResolvedValue({ metrics: [baseMetric], unmatched: [] }),
  collectModelsDev: vi.fn().mockResolvedValue({ metrics: [baseMetric], unmatched: [] }),
  collectLmarena: vi.fn().mockResolvedValue({ metrics: [baseMetric], unmatched: [] }),
  insertMetrics: vi.fn().mockResolvedValue(undefined),
  upsertAaVariants: vi.fn().mockResolvedValue(undefined),
  releaseAlerts: vi.fn().mockResolvedValue({ seeded: false, published: 0, failed: 0 }),
  ...overrides,
});

describe("runRefresh", () => {
  it("calls all three steps and returns allOk=true when all succeed", async () => {
    const deps = makeDeps();
    const result = await runRefresh(deps);

    expect(deps.probe).toHaveBeenCalledOnce();
    expect(deps.collectOpenRouter).toHaveBeenCalledOnce();
    expect(deps.collectArtificialAnalysis).toHaveBeenCalledOnce();
    expect(deps.insertMetrics).toHaveBeenCalledOnce();
    expect(result.allOk).toBe(true);
  });

  it("a failed catalog sync still runs every later step but fails the run", async () => {
    const deps = makeDeps({ syncCatalog: vi.fn().mockRejectedValue(new Error("leg down")) });
    const result = await runRefresh(deps);

    expect(result.catalog.ok).toBe(false);
    expect(result.probe.ok).toBe(true);
    expect(deps.probe).toHaveBeenCalledOnce();
    expect(result.allOk).toBe(false);
  });

  it("continues all remaining steps when probe fails", async () => {
    const deps = makeDeps({
      probe: vi.fn().mockRejectedValue(new Error("probe timeout")),
    });
    const result = await runRefresh(deps);

    expect(result.probe.ok).toBe(false);
    expect(result.collect.ok).toBe(true);
    expect(result.allOk).toBe(false);
    // Subsequent steps still ran
    expect(deps.releaseAlerts).toHaveBeenCalledOnce();
  });

  it("collect step handles partial collector failure via allSettled", async () => {
    // OR throws but the rest succeed — collect step stays ok, the run is degraded
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
    expect(result.degraded).toEqual(["openrouter"]);
    expect(result.allOk).toBe(false);
    // the surviving sources are still persisted
    expect(deps.insertMetrics).toHaveBeenCalledWith(Array(5).fill(baseMetric));
  });

  it("a rejected modelsdev collector marks the run degraded under its name", async () => {
    const deps = makeDeps({
      collectModelsDev: vi.fn().mockRejectedValue(new Error("models.dev down")),
    });
    const result = await runRefresh(deps);

    expect(result.degraded).toEqual(["modelsdev"]);
    expect(result.allOk).toBe(false);
    expect(deps.insertMetrics).toHaveBeenCalledWith(Array(5).fill(baseMetric));
  });

  it("a rejected aa-speech collector marks the run degraded under its name", async () => {
    const deps = makeDeps({
      collectAaSpeech: vi.fn().mockRejectedValue(new Error("speech down")),
    });
    const result = await runRefresh(deps);

    expect(result.degraded).toEqual(["aa-speech"]);
    expect(result.allOk).toBe(false);
  });

  it("a source returning 0 rows degrades the run (rc!=0) but still persists the rest", async () => {
    const deps = makeDeps({
      collectLmarena: vi.fn().mockResolvedValue({ metrics: [], unmatched: [] }),
    });
    const result = await runRefresh(deps);

    expect(result.collect.ok).toBe(true);
    expect(result.degraded).toEqual(["lmarena"]);
    expect(result.allOk).toBe(false);
    expect(deps.insertMetrics).toHaveBeenCalledOnce();
  });

  it("marks collect failed when insertMetrics throws", async () => {
    const deps = makeDeps({
      insertMetrics: vi.fn().mockRejectedValue(new Error("DB error")),
    });
    const result = await runRefresh(deps);

    expect(result.collect.ok).toBe(false);
    expect(result.probe.ok).toBe(true);
    expect(result.allOk).toBe(false);
  });

  it("skips insertMetrics when no metrics are collected", async () => {
    const empty = vi.fn().mockResolvedValue({ metrics: [], unmatched: [] });
    const deps = makeDeps({
      collectOpenRouter: empty,
      collectArtificialAnalysis: empty,
      collectEpoch: empty,
      collectAaSpeech: empty,
      collectModelsDev: empty,
      collectLmarena: empty,
    });
    const result = await runRefresh(deps);

    expect(deps.insertMetrics).not.toHaveBeenCalled();
    expect(result.collect.ok).toBe(true);
    expect(result.degraded).toHaveLength(6);
    expect(result.allOk).toBe(false);
  });

  it("probe message includes accessible/total count", async () => {
    const deps = makeDeps({
      probe: vi
        .fn()
        .mockResolvedValue([{ accessible: true }, { accessible: true }, { accessible: false }]),
    });
    const result = await runRefresh(deps);

    expect(result.probe.message).toContain("2/3");
  });

  it("allOk false when multiple steps fail", async () => {
    const deps = makeDeps({
      probe: vi.fn().mockRejectedValue(new Error("probe error")),
      collectEpoch: vi.fn().mockRejectedValue(new Error("epoch down")),
    });
    const result = await runRefresh(deps);

    expect(result.probe.ok).toBe(false);
    expect(result.collect.ok).toBe(true);
    expect(result.degraded).toEqual(["epoch"]);
    expect(result.allOk).toBe(false);
  });

  it("upserts the AA variants a collector returned, once", async () => {
    const aaVariants = [{ slug: "s", name: "S", lineage: "s", effort: "default" as const, creator: "C" }];
    const deps = makeDeps({
      collectArtificialAnalysis: vi.fn().mockResolvedValue({ metrics: [baseMetric], unmatched: [], aaVariants }),
    });
    await runRefresh(deps);
    expect(deps.upsertAaVariants).toHaveBeenCalledWith(aaVariants);
  });

  it("skips the variant upsert when no collector returned any", async () => {
    const deps = makeDeps();
    await runRefresh(deps);
    expect(deps.upsertAaVariants).not.toHaveBeenCalled();
  });

  it("runs the release alerts once after collect", async () => {
    const deps = makeDeps();
    await runRefresh(deps);
    expect(deps.releaseAlerts).toHaveBeenCalledOnce();
  });

  it("degrades, but still completes, when a publish failed", async () => {
    const deps = makeDeps({
      releaseAlerts: vi.fn().mockResolvedValue({ seeded: false, published: 1, failed: 1 }),
    });
    const result = await runRefresh(deps);
    expect(result.degraded).toEqual(["release-alerts"]);
    expect(result.allOk).toBe(false);
    expect(result.collect.ok).toBe(true);
  });

  it("degrades once when the alerts step itself throws", async () => {
    const deps = makeDeps({ releaseAlerts: vi.fn().mockRejectedValue(new Error("db")) });
    const result = await runRefresh(deps);
    expect(result.alerts.ok).toBe(false);
    expect(result.degraded).toEqual(["release-alerts"]);
  });
});
