/**
 * Sandbox lifecycle for ccbench: the isolated Claude config, the per-run
 * fixture copy, the post-run hidden-file reveal, and the offline helpers a
 * grader is handed.
 *
 * The isolated `CLAUDE_CONFIG_DIR` is load-bearing for validity, not hygiene.
 * Without it the user's global CLAUDE.md, 3 MCP servers, ~44 extra tools and
 * SessionStart hooks load into every sandbox — measured 71 tools and 35k
 * cache-creation tokens, against 27 tools / 0 MCP / 0 hooks / 20.5k with
 * isolation. A benchmark run under the operator's own config measures the
 * operator's config, not the model.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandResult, GradeContext, RunMetrics } from "./types.js";

/** Directory name of the isolated config, created inside the repo root. */
export const BENCH_CONFIG_DIR_NAME = ".ccbench-config";

/** The entire content of the isolated config. Nothing else may be added here —
 *  every extra file is another variable the benchmark does not control. */
export const BENCH_CONFIG_SETTINGS = {
  includeCoAuthoredBy: false,
  hooks: {},
  outputStyle: "default",
} as const;

/** Root of every sandbox. Kept off the repo so a runaway agent cannot edit
 *  modelpick itself. */
export const SANDBOX_ROOT = "/tmp/ccbench";

/** Repo root, derived from this module rather than cwd so the CLI behaves the
 *  same whichever directory it is invoked from. */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

/**
 * Creates (or refreshes) the isolated config dir and returns its path. Refresh
 * is a wipe: the CLI writes session state in here between runs, and a stale
 * `projects/` entry is exactly the kind of carry-over this dir exists to stop.
 */
export async function ensureBenchConfigDir(root: string = repoRoot()): Promise<string> {
  const dir = path.join(root, BENCH_CONFIG_DIR_NAME);
  // Guard the recursive delete on the directory name — this path is computed,
  // and a wrong `root` must not be able to remove anything else.
  if (path.basename(dir) !== BENCH_CONFIG_DIR_NAME) {
    throw new Error(
      `refusing to refresh a config dir that is not ${BENCH_CONFIG_DIR_NAME}: ${dir}`,
    );
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "settings.json"),
    `${JSON.stringify(BENCH_CONFIG_SETTINGS, null, 2)}\n`,
    "utf8",
  );
  return dir;
}

/** Model ids carry `.` and `-`; path segments keep `-` and flatten the rest so
 *  a sandbox path never depends on how a gateway spells its ids. */
export function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]+/g, "_").replace(/^_+|_+$/g, "") || "unnamed";
}

export interface SandboxKey {
  suiteId: string;
  modelId: string;
  taskId: string;
  attempt: number;
}

/** Parent of every sandbox in one suite - removed wholesale at the end. */
export function suiteSandboxRoot(suiteId: string): string {
  return path.join(SANDBOX_ROOT, sanitizeSegment(suiteId));
}

export function sandboxPath(key: SandboxKey): string {
  return path.join(
    suiteSandboxRoot(key.suiteId),
    sanitizeSegment(key.modelId),
    `${sanitizeSegment(key.taskId)}-${key.attempt}`,
  );
}

/** Directory names a fixture keeps to itself: `.hidden/` holds the reference
 *  tests, `.solution/` the reference implementation the grader regression tests
 *  overlay. Neither may ever land in a benchmarked sandbox. */
export const SANDBOX_EXCLUDED_DIRS: readonly string[] = [".hidden", ".solution"];

/** Recursive copy that skips SANDBOX_EXCLUDED_DIRS — written by hand rather than
 *  using `fs.cp`'s filter so it behaves identically under node and bun. */
async function copyTree(src: string, dest: string, skip: (name: string) => boolean): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skip(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, skip);
    else if (entry.isFile()) await fs.copyFile(from, to);
  }
}

export interface CreateSandboxOptions extends SandboxKey {
  /** `fixtures/bench` (or whatever the task registry exports as FIXTURE_ROOT). */
  fixtureRoot: string;
  /** Directory name under the fixture root. */
  fixture: string;
}

/**
 * Copies a fixture into a fresh sandbox. Neither `.hidden/` nor `.solution/`
 * comes along — that is what stops a model from reading the grader's assertions
 * (or the reference implementation) and handing back something that agrees with
 * whatever it happened to write.
 */
export async function createSandbox(options: CreateSandboxOptions): Promise<string> {
  const fixtureDir = path.join(options.fixtureRoot, options.fixture);
  const stat = await fs.stat(fixtureDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`fixture not found: ${fixtureDir}`);
  }
  const dir = sandboxPath(options);
  await fs.rm(dir, { recursive: true, force: true });
  await copyTree(fixtureDir, dir, (name) => SANDBOX_EXCLUDED_DIRS.includes(name));
  return dir;
}

/**
 * Copies the withheld files in after the run. Keys are paths under the
 * fixture's `.hidden/`, values are sandbox-relative destinations — so a grader
 * can drop a reference test exactly where the project's runner expects it.
 */
export async function revealHidden(
  dir: string,
  fixtureRoot: string,
  fixture: string,
  hidden: Record<string, string> | undefined,
): Promise<void> {
  if (!hidden) return;
  const hiddenRoot = path.join(fixtureRoot, fixture, ".hidden");
  for (const [source, destination] of Object.entries(hidden)) {
    const from = path.join(hiddenRoot, source);
    const to = path.join(dir, destination);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }
}

/** Removes a sandbox, refusing anything outside SANDBOX_ROOT. */
export async function removeSandbox(dir: string): Promise<void> {
  if (!path.resolve(dir).startsWith(`${SANDBOX_ROOT}/`)) {
    throw new Error(`refusing to remove a path outside ${SANDBOX_ROOT}: ${dir}`);
  }
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Runs a command inside the sandbox for a grader. Never throws and never uses a
 * shell — a grader that crashes the suite is worse than a task that scores 0.
 */
export function runInSandbox(
  dir: string,
  cmd: string[],
  opts?: { timeoutMs?: number },
): Promise<CommandResult> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const [command, ...args] = cmd;
  if (!command) {
    return Promise.resolve({ code: 1, stdout: "", stderr: "empty command", timedOut: false });
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    // `error` and `close` can both fire; the first one wins.
    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err: Error) => {
      finish({ code: 127, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      finish({ code: code ?? (timedOut ? 124 : 1), stdout, stderr, timedOut });
    });
  });
}

/** Everything a grader is allowed to look at — bound to one sandbox. */
export function makeGradeContext(
  dir: string,
  finalText: string,
  metrics: RunMetrics,
): GradeContext {
  return {
    dir,
    finalText,
    metrics,
    run: (cmd, opts) => runInSandbox(dir, cmd, opts),
    readFile: async (relPath) => fs.readFile(path.join(dir, relPath), "utf8").catch(() => null),
  };
}
