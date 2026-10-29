/**
 * Check the deployment truth table against the files it claims to describe.
 *
 *   bun run verify-deployments            # report, exit 1 on any mismatch
 *   bun run verify-deployments --update   # additionally stamp verified_at on matches
 *
 * Every row in src/db/deployments.ts is a claim about another repo, and claims
 * rot silently — research-gateway ran a whole lead on DeepSeek-V4-Pro long after
 * it had moved, because a dead env var still said so. This reads each row's
 * `config_ref` and asks the only question that matters: does that file still
 * contain that model id?
 *
 * Two kinds of row are checked against a live route table instead, because a
 * source file keeps naming retired ids in comments and constants and a
 * substring match passes falsely:
 *
 * - Workloads that moved to agent-workflows (review, check, research, otel,
 *   prose, diagram, triage, podcast, audio, image, ...) carry
 *   `config_ref: "agw-route:<route-id>[,<route-id>]"`. Their model_id is
 *   compared with `model` of that route in `agw routes --format json` (a
 *   comma-separated list for a slot that spans several routes, e.g. the two
 *   podcast reviewers). `agw` unavailable is a failure, not a pass: there is no
 *   file to fall back on.
 * - The remaining agent-gateway rows (dispatch and the handlers that stay until
 *   the Wave 11 shrink) are compared with `routes[slot].model` of
 *   `agw-legacy routing --json`; when that is unavailable they fall back to the
 *   routing.ts substring check, with a notice. The reverse drift is caught too:
 *   a live legacy route with no agent-gateway row is reported as `unrecorded`
 *   and fails the run like a broken row.
 *
 * Rows with `literal_id: false` are skipped, not failed: a tier alias
 * ("sonnet"), an inherited value, or a deliberate unset that falls through to
 * another service's routing cannot be confirmed by substring. They are reported
 * separately so the count of unverifiable claims stays visible rather than
 * quietly passing.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEPLOYMENTS } from "../src/db/deployments.js";

const LIVE_SERVICE = "agent-gateway";
const ROOT = join(homedir(), "SourceRoot");
const TODAY = new Date().toISOString().slice(0, 10);
const UPDATE = process.argv.includes("--update");

type Outcome = "match" | "mismatch" | "no-file" | "unverifiable" | "indirect";

interface Row {
  outcome: Outcome;
  service: string;
  slot: string;
  model_id: string;
  path: string;
  note: string;
}

/** `dotfiles/config/zsh/claude.zsh:255-267` → `dotfiles/config/zsh/claude.zsh` */
function pathOf(configRef: string): string {
  const colon = configRef.lastIndexOf(":");
  return colon === -1 ? configRef : configRef.slice(0, colon);
}

/** Route name → live model id from `agw-legacy routing --json`, or null when agw-legacy cannot answer. */
function liveRoutes(): Map<string, string> | null {
  try {
    const res = spawnSync("agw-legacy", ["routing", "--json"], { encoding: "utf8" });
    if (res.status !== 0) return null;
    const parsed = JSON.parse(res.stdout) as {
      routes?: Record<string, { model?: string }>;
    };
    if (parsed.routes === undefined) return null;
    const routes = new Map<string, string>();
    for (const [name, route] of Object.entries(parsed.routes)) {
      if (route.model !== undefined) routes.set(name, route.model);
    }
    return routes;
  } catch {
    return null;
  }
}

/** Route id → live model id from `agw routes --format json` (unjournaled read), or null when agw cannot answer. */
function agwRoutes(): Map<string, string> | null {
  try {
    const res = spawnSync("agw", ["routes", "--format", "json"], { encoding: "utf8" });
    if (res.status !== 0) return null;
    const parsed = JSON.parse(res.stdout) as {
      routes?: Record<string, { model?: string }>;
    };
    if (parsed.routes === undefined) return null;
    const routes = new Map<string, string>();
    for (const [id, route] of Object.entries(parsed.routes)) {
      if (route.model !== undefined) routes.set(id, route.model);
    }
    return routes;
  } catch {
    return null;
  }
}

const AGW_PREFIX = "agw-route:";

const live = liveRoutes();
const agw = agwRoutes();
if (agw === null) {
  console.log("notice: `agw routes` unavailable — agent-workflows rows cannot be verified\n");
}
if (live === null) {
  console.log(
    `notice: agw-legacy routing unavailable — ${LIVE_SERVICE} rows fall back to the routing.ts substring check\n`,
  );
}

const rows: Row[] = DEPLOYMENTS.map((d) => {
  const rel = d.config_ref.startsWith(AGW_PREFIX) ? "agw routes" : pathOf(d.config_ref);
  const abs = join(ROOT, rel);
  const base = {
    service: d.service,
    slot: d.slot,
    model_id: d.model_id,
    path: rel,
  };

  if (d.literal_id === false) {
    return { ...base, outcome: "indirect", note: "alias / inherited / unset — check by hand" };
  }
  if (d.config_ref.startsWith(AGW_PREFIX)) {
    const ids = d.config_ref.slice(AGW_PREFIX.length).split(",");
    if (agw === null) {
      return { ...base, outcome: "unverifiable", note: "`agw routes` did not answer" };
    }
    const models = ids.map((id) => agw.get(id));
    const missing = ids.filter((_, i) => models[i] === undefined);
    if (missing.length > 0) {
      return {
        ...base,
        outcome: "mismatch",
        note: `route ${missing.join(", ")} is not in agw routes`,
      };
    }
    const liveModels = models.join(",");
    return liveModels === d.model_id
      ? { ...base, outcome: "match", note: "" }
      : {
          ...base,
          outcome: "mismatch",
          note: `agw route ${ids.join(",")} runs ${liveModels}, row claims ${d.model_id}`,
        };
  }
  const liveModel = d.service === LIVE_SERVICE ? live?.get(d.slot) : undefined;
  if (liveModel !== undefined) {
    return liveModel === d.model_id
      ? { ...base, outcome: "match", note: "" }
      : {
          ...base,
          outcome: "mismatch",
          note: `live routing runs ${liveModel}, row claims ${d.model_id}`,
        };
  }
  if (!existsSync(abs)) {
    return { ...base, outcome: "no-file", note: "config_ref points at a file that is not there" };
  }
  const contains = readFileSync(abs, "utf8").includes(d.model_id);
  return contains
    ? { ...base, outcome: "match", note: "" }
    : { ...base, outcome: "mismatch", note: "file no longer contains this model id" };
});

const by = (o: Outcome): Row[] => rows.filter((r) => r.outcome === o);
const broken = [...by("mismatch"), ...by("no-file"), ...by("unverifiable")];
const recorded = new Set(DEPLOYMENTS.filter((d) => d.service === LIVE_SERVICE).map((d) => d.slot));
const unrecorded = [...(live?.keys() ?? [])].filter((route) => !recorded.has(route));

const ICON: Record<Outcome, string> = {
  match: "✓",
  mismatch: "✗",
  "no-file": "✗",
  unverifiable: "✗",
  indirect: "·",
};

for (const r of [...broken, ...by("indirect")]) {
  console.log(`${ICON[r.outcome]} ${r.service}/${r.slot} → ${r.model_id}`);
  console.log(`    ${r.path}${r.note === "" ? "" : ` — ${r.note}`}`);
}

for (const route of unrecorded) {
  console.log(`✗ ${LIVE_SERVICE}/${route} — live route has no deployment row`);
}

console.log(
  `\n${by("match").length} verified · ${by("indirect").length} indirect · ${broken.length} broken · ${unrecorded.length} unrecorded (of ${rows.length})`,
);

if (UPDATE && broken.length === 0 && unrecorded.length === 0) {
  // Only stamp when nothing is broken: a partial stamp would mark the healthy
  // rows fresh and leave the broken ones looking merely stale, which is the
  // less alarming of the two states and therefore the wrong one to show.
  const file = join(import.meta.dirname, "..", "src", "db", "deployments.ts");
  const src = readFileSync(file, "utf8");
  const next = src.replace(/const VERIFIED = "\d{4}-\d{2}-\d{2}";/, `const VERIFIED = "${TODAY}";`);
  if (next !== src) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, next);
    console.log(`stamped VERIFIED = ${TODAY} — re-run bun run db:seed`);
  }
}

process.exit(broken.length === 0 && unrecorded.length === 0 ? 0 : 1);
