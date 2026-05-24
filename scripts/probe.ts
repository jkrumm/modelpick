import { runProbe } from "../src/server/iu/probe.js";
import { client } from "../src/db/index.js";

const results = await runProbe();

const accessible = results.filter((r) => r.accessible).length;
console.log(`Probed ${results.length} models — ${accessible} accessible\n`);

for (const r of results) {
  const status = r.accessible ? "✓" : "✗";
  const latency = r.latency_ms !== null ? `${r.latency_ms}ms` : "—";
  const note = r.error ? ` (${r.error})` : "";
  console.log(
    `  ${status} ${r.modality.padEnd(3)} ${r.model_id.padEnd(40)} ${latency.padStart(8)} ${r.residency}${note}`,
  );
}

await client.end();
