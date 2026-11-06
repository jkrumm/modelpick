import { createReleaseAlertDeps } from "../src/server/alerts/store.js";
import { runReleaseAlerts } from "../src/server/alerts/releases.js";
import { client } from "../src/db/index.js";

// Standalone run of the refresh's alert step (no catalog sync, so no new IU ids):
// `MODELPICK_NOTIFY_DRY=1 bun run alerts` prints the pushes instead of publishing.
const summary = await runReleaseAlerts({ added: [], deps: createReleaseAlertDeps() });
console.log(`[alerts] ${JSON.stringify(summary)}`);
await client.end();
process.exit(summary.failed > 0 ? 1 : 0);
