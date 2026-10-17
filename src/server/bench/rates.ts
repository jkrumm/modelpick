/**
 * Rate card shared by the single-call benches: latest `price_in`/`price_out`
 * per model from `metric_snapshot` (never hardcoded), and the one cost formula.
 * Imports the DB — keep it out of anything a client bundle can reach.
 */
import { and, desc, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { metricSnapshot } from "../../db/schema.js";

export interface Rate {
  input: number;
  output: number;
}

/** Latest `price_in`/`price_out` per model, in USD per 1M tokens, from whatever
 *  source most recently reported it. A model with no rate gets no entry — its
 *  cost stays null rather than guessed. */
export async function loadRates(modelIds: string[]): Promise<Map<string, Rate>> {
  const rows = await db
    .select({
      model_id: metricSnapshot.model_id,
      metric: metricSnapshot.metric,
      value: metricSnapshot.value,
    })
    .from(metricSnapshot)
    .where(
      and(
        inArray(metricSnapshot.model_id, modelIds),
        inArray(metricSnapshot.metric, ["price_in", "price_out"]),
      ),
    )
    .orderBy(desc(metricSnapshot.captured_at));

  const priceIn = new Map<string, number>();
  const priceOut = new Map<string, number>();
  for (const row of rows) {
    if (row.metric === "price_in" && !priceIn.has(row.model_id)) priceIn.set(row.model_id, row.value);
    if (row.metric === "price_out" && !priceOut.has(row.model_id)) priceOut.set(row.model_id, row.value);
  }
  const rates = new Map<string, Rate>();
  for (const id of modelIds) {
    const input = priceIn.get(id);
    const output = priceOut.get(id);
    if (input !== undefined && output !== undefined) rates.set(id, { input, output });
  }
  return rates;
}

export function costOf(rate: Rate | undefined, promptTokens: number, visible: number, reasoning: number): number | null {
  if (!rate) return null;
  return (promptTokens * rate.input + (visible + reasoning) * rate.output) / 1_000_000;
}
