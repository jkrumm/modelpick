import { writeFileSync } from "node:fs";
import { db } from "../db/index.js";
import { getLatestMetricsBySourceMetric, getLatestRecommendations } from "../db/queries.js";
import { pickProbe } from "../db/schema.js";
import { renderStack } from "../stack-render.js";
import { resolveStackPrices } from "./stack-prices.js";

/** Re-renders STACK.md from src/stack.ts, deployments and the latest DB metrics. Reads only. */
export async function writeStackFile(): Promise<string> {
  const prices = resolveStackPrices(
    await getLatestMetricsBySourceMetric(),
    await db.select().from(pickProbe),
  );
  const recommended = new Map(
    (await getLatestRecommendations()).map((r) => [r.category, r.model_id]),
  );
  writeFileSync(new URL("../../STACK.md", import.meta.url), renderStack({ prices, recommended }));
  return "wrote STACK.md";
}
