import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export interface AgwRoute {
  route: string;
  wire: string;
  model: string;
  effort: string | null;
}

const TTL_MS = 5 * 60_000;
// launchd gives the web agent a bare PATH; agw lives in ~/.local/bin, so look it up absolutely.
const AGW_BIN = join(homedir(), ".local/bin/agw");

interface RawRoute {
  wire?: string;
  model?: string;
  effort?: string;
  price?: unknown;
}

/**
 * LLM routes from `agw routes --format json`. The JSON can carry raw control characters inside
 * `table`, which strict JSON.parse rejects; stripping them is safe because only `routes` is read
 * and its values are plain ASCII. Non-LLM routes (priced per unit: audio, image tools) and the
 * typed-answer `iu-decision` wire are dropped.
 */
export function parseAgwRoutes(stdout: string): AgwRoute[] {
  const parsed = JSON.parse(Array.from(stdout, (c) => (c.charCodeAt(0) < 32 ? " " : c)).join("")) as {
    routes?: Record<string, RawRoute>;
  };
  if (parsed.routes === undefined) throw new Error("agw routes: no `routes` key");
  const out: AgwRoute[] = [];
  for (const [route, r] of Object.entries(parsed.routes)) {
    if (r.model === undefined || r.wire === undefined) continue;
    if (r.price !== undefined || r.wire === "iu-decision") continue;
    if (/-tts$|transcribe|whisper/.test(r.model)) continue;
    out.push({ route, wire: r.wire, model: r.model, effort: r.effort ?? null });
  }
  return out;
}

function runAgw(): Promise<string> {
  const bin = existsSync(AGW_BIN) ? AGW_BIN : "agw";
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ["routes", "--format", "json"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

export interface RoutesResult {
  routes: AgwRoute[];
  error: string | null;
}

let cache: { at: number; routes: AgwRoute[] } | null = null;

/** Routes cached 5 minutes in memory; on error the stale copy is served (no error), else an empty list + error. */
export async function loadAgwRoutes(run: () => Promise<string> = runAgw): Promise<RoutesResult> {
  if (cache && Date.now() - cache.at < TTL_MS) return { routes: cache.routes, error: null };
  try {
    const routes = parseAgwRoutes(await run());
    cache = { at: Date.now(), routes };
    return { routes, error: null };
  } catch (err) {
    const error = `agw routes unavailable: ${err instanceof Error ? err.message : String(err)}`;
    return cache ? { routes: cache.routes, error: null } : { routes: [], error };
  }
}

/** Test seam. */
export function resetAgwRoutesCache(): void {
  cache = null;
}
