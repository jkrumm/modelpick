import type { NormalizedMetric, CollectorResult } from "./collectors/normalize.js";

export interface RefreshStepResult {
  ok: boolean;
  message: string;
}

export interface RefreshResult {
  catalog: RefreshStepResult;
  probe: RefreshStepResult;
  collect: RefreshStepResult;
  recommend: RefreshStepResult;
  /** STACK.md re-render. Its failure is reported but never stops the run's other work. */
  stack: RefreshStepResult;
  /** Collectors that failed or returned 0 rows. Their metrics are still persisted; the run is not allOk. */
  degraded: string[];
  allOk: boolean;
}

export interface RefreshDeps {
  /** Step 0: syncs the IU catalog from the live /models legs. */
  syncCatalog: () => Promise<{ total: number; added: string[]; removed: string[] }>;
  probe: () => Promise<Array<{ accessible: boolean }>>;
  collectOpenRouter: () => Promise<CollectorResult>;
  collectArtificialAnalysis: () => Promise<CollectorResult>;
  collectEpoch: () => Promise<CollectorResult>;
  collectAaSpeech: () => Promise<CollectorResult>;
  collectModelsDev: () => Promise<CollectorResult>;
  collectLmarena: () => Promise<CollectorResult>;
  /** Persists the merged metrics list to the DB. Called only when metrics.length > 0. */
  insertMetrics: (metrics: NormalizedMetric[]) => Promise<void>;
  runRecommender: () => Promise<void>;
  /** Last step: re-renders STACK.md from the fresh prices and recommendations. */
  renderStack: () => Promise<string>;
}

async function runStep(name: string, fn: () => Promise<string>): Promise<RefreshStepResult> {
  try {
    const message = await fn();
    console.log(`[refresh] ${name}: ${message}`);
    return { ok: true, message };
  } catch (err) {
    const message = String(err);
    console.error(`[refresh] ${name} FAILED: ${message}`);
    return { ok: false, message };
  }
}

/**
 * Orchestrates the daily refresh pipeline: catalog → probe → collect → recommend → stack render.
 * Each step runs independently — one failure does not abort subsequent steps.
 * Within collect, individual collector failures are isolated via Promise.allSettled.
 */
export async function runRefresh(deps: RefreshDeps): Promise<RefreshResult> {
  const degraded: string[] = [];
  const catalog = await runStep("catalog", async () => {
    const r = await deps.syncCatalog();
    return `${r.total} models (+${r.added.length} / -${r.removed.length})`;
  });

  const probe = await runStep("probe", async () => {
    const results = await deps.probe();
    const accessible = results.filter((r) => r.accessible).length;
    return `${accessible}/${results.length} accessible`;
  });

  const collect = await runStep("collect", async () => {
    const collectors = [
      ["openrouter", "OR", deps.collectOpenRouter],
      ["artificialanalysis", "AA", deps.collectArtificialAnalysis],
      ["aa-speech", "AA speech", deps.collectAaSpeech],
      ["modelsdev", "models.dev", deps.collectModelsDev],
      ["epoch", "Epoch", deps.collectEpoch],
      ["lmarena", "LMArena", deps.collectLmarena],
    ] as const;
    const settled = await Promise.allSettled(collectors.map(([, , run]) => run()));

    const metrics: NormalizedMetric[] = [];
    const statuses: string[] = [];
    collectors.forEach(([name, label], i) => {
      const result = settled[i];
      if (result?.status !== "fulfilled") {
        degraded.push(name);
        statuses.push(`${label} failed`);
        return;
      }
      if (result.value.metrics.length === 0) degraded.push(name);
      for (const m of result.value.metrics) metrics.push(m);
      statuses.push(`${result.value.metrics.length} ${label}`);
    });

    if (metrics.length > 0) {
      await deps.insertMetrics(metrics);
    }
    return `${metrics.length} metrics (${statuses.join(", ")})`;
  });

  const recommend = await runStep("recommend", async () => {
    await deps.runRecommender();
    return "done";
  });

  const stack = await runStep("stack", deps.renderStack);

  if (degraded.length > 0) console.error(`[refresh] degraded sources: ${degraded.join(", ")}`);
  const allOk = catalog.ok && probe.ok && collect.ok && recommend.ok && stack.ok && degraded.length === 0;
  const okCount = [catalog, probe, collect, recommend, stack].filter((s) => s.ok).length;
  console.log(
    `[refresh] summary: ${okCount}/5 steps ok${degraded.length > 0 ? `, ${degraded.length} degraded source(s)` : ""}`,
  );

  return { catalog, probe, collect, recommend, stack, degraded, allOk };
}
