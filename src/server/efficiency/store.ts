import { sql } from "drizzle-orm";
import { db as defaultDb } from "../../db/index.js";
import { aaVariant } from "../../db/schema.js";
import type { AaVariantRow } from "../collectors/normalize.js";

const CHUNK = 100;

/**
 * Upserts today's fetch. `first_seen_at` is set once; `updated_at` moves on every upsert. A slug
 * absent from the fetch is left alone, so its stale `updated_at` marks it as vanished.
 */
export async function upsertAaVariants(
  rows: readonly AaVariantRow[],
  db: typeof defaultDb = defaultDb,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(aaVariant)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: aaVariant.slug,
        set: {
          name: sql`excluded.name`,
          lineage: sql`excluded.lineage`,
          effort: sql`excluded.effort`,
          creator: sql`excluded.creator`,
          release_date: sql`excluded.release_date`,
          intelligence: sql`excluded.intelligence`,
          cost_per_task: sql`excluded.cost_per_task`,
          price_in: sql`excluded.price_in`,
          price_out: sql`excluded.price_out`,
          price_cache_read: sql`excluded.price_cache_read`,
          price_cache_write: sql`excluded.price_cache_write`,
          tps: sql`excluded.tps`,
          ttft_sec: sql`excluded.ttft_sec`,
          ttfat_sec: sql`excluded.ttfat_sec`,
          e2e_sec: sql`excluded.e2e_sec`,
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      });
  }
}
