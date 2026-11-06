import { createReleaseAlertDeps } from "../src/server/alerts/store.js";
import { runReleaseAlerts } from "../src/server/alerts/releases.js";
import { client } from "../src/db/index.js";

// Standalone run of the refresh's alert step:
// `MODELPICK_NOTIFY_DRY=1 bun run alerts` prints the pushes instead of publishing.
const summary = await runReleaseAlerts({ deps: createReleaseAlertDeps() });
console.log(`[alerts] ${JSON.stringify(summary)}`);
await client.end();
process.exit(summary.failed > 0 ? 1 : 0);
