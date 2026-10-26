import { writeFileSync } from "node:fs";
import { db, client } from "../src/db/index.js";
import {
  getLatestMetricsBySourceMetric,
  getLatestRecommendations,
} from "../src/db/queries.js";
import { pickProbe } from "../src/db/schema.js";
import { renderStack } from "../src/stack-render.js";

const prices = new Map<string, { in: number | null; out: number | null }>();

// List price: models.dev when it has the model, else the mean of the other sources.
const bySource = new Map<
  string,
  { in: number[]; out: number[]; modelsdev: { in?: number; out?: number } }
>();
for (const m of await getLatestMetricsBySourceMetric()) {
  if (m.metric !== "price_in" && m.metric !== "price_out") continue;
  const entry = bySource.get(m.model_id) ?? { in: [], out: [], modelsdev: {} };
  const side = m.metric === "price_in" ? "in" : "out";
  if (m.source === "modelsdev") entry.modelsdev[side] = m.value;
  else entry[side].push(m.value);
  bySource.set(m.model_id, entry);
}
const mean = (v: number[]): number | null =>
  v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
for (const [id, e] of bySource) {
  prices.set(id, {
    in: e.modelsdev.in ?? mean(e.in),
    out: e.modelsdev.out ?? mean(e.out),
  });
}

// Measured IU rates (solved from usage.cost) win over list prices.
for (const p of await db.select().from(pickProbe)) {
  if (p.price_in_per_m === null && p.price_out_per_m === null) continue;
  const list = prices.get(p.model_id);
  prices.set(p.model_id, {
    in: p.price_in_per_m ?? list?.in ?? null,
    out: p.price_out_per_m ?? list?.out ?? null,
  });
}

const recommended = new Map(
  (await getLatestRecommendations()).map((r) => [r.category, r.model_id]),
);

writeFileSync(
  new URL("../STACK.md", import.meta.url),
  renderStack({ prices, recommended }),
);
console.log("[stack] wrote STACK.md");
await client.end();
