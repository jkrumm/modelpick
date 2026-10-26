/**
 * Syncs the IU model catalog from the gateway's live per-leg /models listings.
 *
 *   make models        (or: bun run models)
 *
 * Writes the committed snapshot src/db/iu-catalog.ts, upserts the models and marks
 * vanished ids iu_listed=false (never deletes).
 */
import { client } from "../src/db/index.js";
import { syncCatalog } from "../src/server/iu/catalog-sync.js";

try {
  const r = await syncCatalog();
  console.log(`[sync-catalog] ${r.total} models; legs:`, r.legs);
  console.log(`[sync-catalog] by modality:`, r.byModality);
  console.log(`[sync-catalog] added ${r.added.length}${r.added.length ? `: ${r.added.join(", ")}` : ""}`);
  console.log(
    `[sync-catalog] removed ${r.removed.length}${r.removed.length ? `: ${r.removed.join(", ")}` : ""}`,
  );
  console.log(`[sync-catalog] hidden-callable (kept by hand, not in any /models leg):`, r.hidden);
  console.log(`[sync-catalog] referenced but unlisted (deployments.ts / MY_STACK):`, r.referencedUnlisted);
} finally {
  await client.end();
}
