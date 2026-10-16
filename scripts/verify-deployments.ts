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
 * agent-gateway rows are the exception: their `config_ref` (routing.ts) keeps
 * naming retired ids in comments and constants, so a substring match passes
 * falsely. Their model_id is compared with `routes[slot].model` of the live
 * routing table instead (`agw routing --json`); when `agw` is unavailable they
 * fall back to the substring check, with a notice.
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

type Outcome = "match" | "mismatch" | "no-file" | "indirect";

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

/** Route name → live model id from `agw routing --json`, or null when agw cannot answer. */
function liveRoutes(): Map<string, string> | null {
  try {
    const res = spawnSync("agw", ["routing", "--json"], { encoding: "utf8" });
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

const live = liveRoutes();
if (live === null) {
  console.log(
    `notice: agw routing unavailable — ${LIVE_SERVICE} rows fall back to the routing.ts substring check\n`,
  );
}

const rows: Row[] = DEPLOYMENTS.map((d) => {
  const rel = pathOf(d.config_ref);
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
const broken = [...by("mismatch"), ...by("no-file")];

const ICON: Record<Outcome, string> = {
  match: "✓",
  mismatch: "✗",
  "no-file": "✗",
  indirect: "·",
};

for (const r of [...broken, ...by("indirect")]) {
  console.log(`${ICON[r.outcome]} ${r.service}/${r.slot} → ${r.model_id}`);
  console.log(`    ${r.path}${r.note === "" ? "" : ` — ${r.note}`}`);
}

console.log(
  `\n${by("match").length} verified · ${by("indirect").length} indirect · ${broken.length} broken (of ${rows.length})`,
);

if (UPDATE && broken.length === 0) {
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

process.exit(broken.length === 0 ? 0 : 1);
