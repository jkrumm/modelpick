import type { NormalizedMetric, CollectorResult } from "./collectors/normalize.js";

export interface RefreshStepResult {
  ok: boolean;
  message: string;
}

export interface RefreshResult {
  probe: RefreshStepResult;
  collect: RefreshStepResult;
  recommend: RefreshStepResult;
  news: RefreshStepResult;
  allOk: boolean;
}

export interface RefreshDeps {
  probe: () => Promise<Array<{ accessible: boolean }>>;
  collectOpenRouter: () => Promise<CollectorResult>;
  collectArtificialAnalysis: () => Promise<CollectorResult>;
  /** Persists the merged metrics list to the DB. Called only when metrics.length > 0. */
  insertMetrics: (metrics: NormalizedMetric[]) => Promise<void>;
  runRecommender: () => Promise<void>;
  collectNews: () => Promise<{ inserted: number }>;
}

async function runStep(
  name: string,
  fn: () => Promise<string>,
): Promise<RefreshStepResult> {
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
 * Orchestrates the daily refresh pipeline: probe → collect → recommend → news.
 * Each step runs independently — one failure does not abort subsequent steps.
 * Within collect, individual collector failures are isolated via Promise.allSettled.
 */
export async function runRefresh(deps: RefreshDeps): Promise<RefreshResult> {
  const probe = await runStep("probe", async () => {
    const results = await deps.probe();
    const accessible = results.filter((r) => r.accessible).length;
    return `${accessible}/${results.length} accessible`;
  });

  const collect = await runStep("collect", async () => {
    const [orSettled, aaSettled] = await Promise.allSettled([
      deps.collectOpenRouter(),
      deps.collectArtificialAnalysis(),
    ]);

    const metrics: NormalizedMetric[] = [];
    if (orSettled.status === "fulfilled") {
      for (const m of orSettled.value.metrics) metrics.push(m);
    }
    if (aaSettled.status === "fulfilled") {
      for (const m of aaSettled.value.metrics) metrics.push(m);
    }

    if (metrics.length > 0) {
      await deps.insertMetrics(metrics);
    }

    const orStatus =
      orSettled.status === "fulfilled"
        ? `${orSettled.value.metrics.length} OR`
        : "OR failed";
    const aaStatus =
      aaSettled.status === "fulfilled"
        ? `${aaSettled.value.metrics.length} AA`
        : "AA failed";
    return `${metrics.length} metrics (${orStatus}, ${aaStatus})`;
  });

  const recommend = await runStep("recommend", async () => {
    await deps.runRecommender();
    return "done";
  });

  const news = await runStep("news", async () => {
    const result = await deps.collectNews();
    return `${result.inserted} new items`;
  });

  const allOk = probe.ok && collect.ok && recommend.ok && news.ok;
  const okCount = [probe, collect, recommend, news].filter((s) => s.ok).length;
  console.log(`[refresh] summary: ${okCount}/4 steps ok`);

  return { probe, collect, recommend, news, allOk };
}
