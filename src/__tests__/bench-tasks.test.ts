import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BENCH_TASKS,
  CORE_TASK_IDS,
  DEEP_SEARCH_ANSWER,
  EXPR_BLOCKS,
  FIXTURE_ROOT,
  HARD_TASK_IDS,
  LOCATE_ANSWER,
  getTasks,
} from "../server/bench/tasks.js";
import {
  SANDBOX_EXCLUDED_DIRS,
  createSandbox,
  makeGradeContext,
  removeSandbox,
  revealHidden,
} from "../server/bench/sandbox.js";
import { BENCH_DIMENSION } from "../server/bench/types.js";
import type {
  BenchTask,
  CommandResult,
  GradeContext,
  RunMetrics,
  TaskGrade,
} from "../server/bench/types.js";

// ── stubs ────────────────────────────────────────────────────────────────────

function stubMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    ok: true,
    failure: "none",
    durationMs: 0,
    apiDurationMs: null,
    ttftMs: null,
    numTurns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    thinkingTokens: 0,
    costUsd: null,
    toolCalls: 0,
    toolCallsByName: {},
    toolErrors: 0,
    parallelBatches: 0,
    maxParallelWidth: 0,
    apiErrors: 0,
    terminalReason: null,
    filesEdited: [],
    notes: [],
    ...overrides,
  };
}

const FAILED_COMMAND: CommandResult = { code: 1, stdout: "", stderr: "", timedOut: false };

/** A context that looks like a model which produced nothing at all. */
function emptyContext(dir: string, overrides: Partial<GradeContext> = {}): GradeContext {
  return {
    dir,
    finalText: "",
    metrics: stubMetrics(),
    run: async () => FAILED_COMMAND,
    readFile: async () => null,
    ...overrides,
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccbench-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function exists(absPath: string): Promise<boolean> {
  return await fs
    .stat(absPath)
    .then(() => true)
    .catch(() => false);
}

// ── registry shape ───────────────────────────────────────────────────────────

describe("BENCH_TASKS", () => {
  it("has ten tasks with unique ids", () => {
    expect(BENCH_TASKS).toHaveLength(10);
    const ids = BENCH_TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "locate",
      "fix-failing-test",
      "implement-spec",
      "thread-field",
      "batch-read",
      "house-rules",
      "parser-spec",
      "perf-refactor",
      "multi-bug",
      "deep-search",
    ]);
  });

  it("declares only known dimensions, at least one per task", () => {
    for (const task of BENCH_TASKS) {
      expect(task.measures.length, task.id).toBeGreaterThan(0);
      for (const dimension of task.measures) {
        expect(BENCH_DIMENSION, `${task.id} -> ${dimension}`).toContain(dimension);
      }
    }
  });

  it("gives every task a non-empty prompt and sane limits", () => {
    for (const task of BENCH_TASKS) {
      expect(task.prompt.trim().length, task.id).toBeGreaterThan(80);
      expect(task.maxTurns, task.id).toBeGreaterThan(0);
      expect(task.timeoutMs, task.id).toBeGreaterThan(0);
    }
  });
});

describe("getTasks", () => {
  it("returns everything when no ids are given", () => {
    expect(getTasks()).toHaveLength(BENCH_TASKS.length);
    expect(getTasks([])).toHaveLength(BENCH_TASKS.length);
  });

  it("returns the named subset", () => {
    const tasks = getTasks(["locate"]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("locate");
  });

  it("throws with the valid ids on an unknown id", () => {
    expect(() => getTasks(["nope"])).toThrow(/Unknown bench task "nope"/);
    expect(() => getTasks(["nope"])).toThrow(/house-rules/);
  });
});

// ── fixtures on disk ─────────────────────────────────────────────────────────

describe("fixtures", () => {
  it("has a directory for every task", async () => {
    for (const task of BENCH_TASKS) {
      expect(await exists(path.join(FIXTURE_ROOT, task.fixture)), task.fixture).toBe(true);
    }
  });

  it("has every declared hidden source under .hidden/", async () => {
    for (const task of BENCH_TASKS) {
      for (const source of Object.keys(task.hidden ?? {})) {
        const absPath = path.join(FIXTURE_ROOT, task.fixture, ".hidden", source);
        expect(await exists(absPath), `${task.fixture}/.hidden/${source}`).toBe(true);
      }
    }
  });

  it("ships no fixture that declares dependencies", async () => {
    for (const task of BENCH_TASKS) {
      const manifestPath = path.join(FIXTURE_ROOT, task.fixture, "package.json");
      const raw = await fs.readFile(manifestPath, "utf8").catch(() => null);
      if (raw === null) continue;
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      expect(manifest["dependencies"], task.fixture).toBeUndefined();
      expect(manifest["devDependencies"], task.fixture).toBeUndefined();
    }
  });

  it("ships no node_modules or .gitignore inside a fixture", async () => {
    for (const task of BENCH_TASKS) {
      const root = path.join(FIXTURE_ROOT, task.fixture);
      expect(await exists(path.join(root, "node_modules")), task.fixture).toBe(false);
      expect(await exists(path.join(root, ".gitignore")), task.fixture).toBe(false);
    }
  });
});

// ── the locate answer key ────────────────────────────────────────────────────

describe("locate answer key", () => {
  it("points at the line that actually declares the target function", async () => {
    const absPath = path.join(FIXTURE_ROOT, "locate", LOCATE_ANSWER.file);
    const lines = (await fs.readFile(absPath, "utf8")).split("\n");
    const line = lines[LOCATE_ANSWER.line - 1] ?? "";
    expect(line).toContain(LOCATE_ANSWER.symbol);
    expect(line).toMatch(/^export function /);
  });

  it("plants exactly one cents-to-euro-string formatter in the fixture", async () => {
    const root = path.join(FIXTURE_ROOT, "locate");
    const files = await fs.readdir(path.join(root, "src"), { recursive: true });
    const hits: string[] = [];
    for (const rel of files) {
      const absPath = path.join(root, "src", String(rel));
      if (!absPath.endsWith(".ts")) continue;
      const source = await fs.readFile(absPath, "utf8");
      if (source.includes(`export function ${LOCATE_ANSWER.symbol}(`)) hits.push(String(rel));
    }
    expect(hits).toEqual([path.relative("src", LOCATE_ANSWER.file)]);
  });
});

// ── grader robustness ────────────────────────────────────────────────────────

describe("graders against an empty sandbox", () => {
  for (const task of BENCH_TASKS) {
    it(`${task.id} scores 0 without throwing`, async () => {
      const grade = await withTempDir((dir) => task.grade(emptyContext(dir)));
      expect(grade.score).toBe(0);
      expect(grade.passed).toBe(false);
      expect(grade.checks.length).toBeGreaterThan(0);
      for (const check of grade.checks) {
        expect(check.detail, `${task.id}/${check.name}`).toBeTruthy();
      }
    });
  }
});

// ── the two pure-text graders, given a correct answer ────────────────────────

function taskById(id: string): BenchTask {
  const task = getTasks([id])[0];
  if (!task) throw new Error(`missing task ${id}`);
  return task;
}

describe("locate grader", () => {
  it("passes a bare path:line answer", async () => {
    const grade = await withTempDir((dir) =>
      taskById("locate").grade(
        emptyContext(dir, { finalText: `${LOCATE_ANSWER.file}:${LOCATE_ANSWER.line}` }),
      ),
    );
    expect(grade.passed).toBe(true);
    expect(grade.score).toBe(1);
  });

  it("tolerates surrounding backticks and a ./ prefix", async () => {
    const grade = await withTempDir((dir) =>
      taskById("locate").grade(emptyContext(dir, { finalText: "`./src/report/currency.ts:7`\n" })),
    );
    expect(grade.passed).toBe(true);
  });

  it("gives partial credit for the right file at the wrong line", async () => {
    const grade = await withTempDir((dir) =>
      taskById("locate").grade(emptyContext(dir, { finalText: "src/report/currency.ts:14" })),
    );
    expect(grade.passed).toBe(false);
    expect(grade.score).toBeCloseTo(1 / 5);
  });

  it("scores 0 for the wrong file", async () => {
    const grade = await withTempDir((dir) =>
      taskById("locate").grade(emptyContext(dir, { finalText: "src/money/format.ts:2" })),
    );
    expect(grade.score).toBe(0);
  });
});

describe("batch-read grader", () => {
  const answer = {
    "a.md": "KX7-QQ2-9F1",
    "b.md": "MB4-TT8-3D6",
    "c.md": "RZ9-LN5-7A2",
    "d.md": "PW2-HJ6-4C8",
    "e.md": "VD5-XS3-1E7",
    "f.md": "GQ8-YK1-6B4",
  };

  it("agrees with the tokens actually planted in the fixture", async () => {
    for (const [file, token] of Object.entries(answer)) {
      const source = await fs.readFile(
        path.join(FIXTURE_ROOT, "batch-read", "notes", file),
        "utf8",
      );
      expect(source, file).toContain(`token: ${token}`);
    }
  });

  it("passes a bare JSON object from a batched run", async () => {
    const grade = await withTempDir((dir) =>
      taskById("batch-read").grade(
        emptyContext(dir, {
          finalText: JSON.stringify(answer),
          metrics: stubMetrics({ maxParallelWidth: 6, toolCalls: 6, toolErrors: 0 }),
        }),
      ),
    );
    expect(grade.passed).toBe(true);
    expect(grade.score).toBe(1);
  });

  it("tolerates a json code fence and trailing prose", async () => {
    const grade = await withTempDir((dir) =>
      taskById("batch-read").grade(
        emptyContext(dir, {
          finalText: `Here you go:\n\`\`\`json\n${JSON.stringify(answer, null, 2)}\n\`\`\`\n`,
          metrics: stubMetrics({ maxParallelWidth: 3, toolCalls: 6 }),
        }),
      ),
    );
    expect(grade.passed).toBe(true);
  });

  it("docks the batching check when every read was serial", async () => {
    const grade = await withTempDir((dir) =>
      taskById("batch-read").grade(
        emptyContext(dir, {
          finalText: JSON.stringify(answer),
          metrics: stubMetrics({ maxParallelWidth: 1, toolCalls: 6 }),
        }),
      ),
    );
    expect(grade.passed).toBe(false);
    expect(grade.score).toBeCloseTo(5 / 7);
  });

  it("fails a wrong token", async () => {
    const grade = await withTempDir((dir) =>
      taskById("batch-read").grade(
        emptyContext(dir, {
          finalText: JSON.stringify({ ...answer, "c.md": "WRONG" }),
          metrics: stubMetrics({ maxParallelWidth: 6, toolCalls: 6 }),
        }),
      ),
    );
    expect(grade.passed).toBe(false);
  });
});

// ── the hard tier ────────────────────────────────────────────────────────────

describe("task tiers", () => {
  it("lists all ten tasks, core first then hard", () => {
    expect(BENCH_TASKS.map((task) => task.id)).toEqual([...CORE_TASK_IDS, ...HARD_TASK_IDS]);
    expect(CORE_TASK_IDS).toHaveLength(6);
    expect(HARD_TASK_IDS).toHaveLength(4);
    expect(HARD_TASK_IDS).toEqual(["parser-spec", "perf-refactor", "multi-bug", "deep-search"]);
  });

  it("expands the core and hard aliases", () => {
    expect(getTasks(["core"]).map((task) => task.id)).toEqual([...CORE_TASK_IDS]);
    expect(getTasks(["hard"]).map((task) => task.id)).toEqual([...HARD_TASK_IDS]);
    expect(getTasks(["core", "hard"])).toHaveLength(10);
    expect(getTasks(["hard", "locate"]).map((task) => task.id)).toEqual([
      ...HARD_TASK_IDS,
      "locate",
    ]);
  });

  it("still throws on an unknown id, and names the aliases", () => {
    expect(() => getTasks(["medium"])).toThrow(/Unknown bench task "medium"/);
    expect(() => getTasks(["medium"])).toThrow(/core, hard/);
  });

  it("gives every hard task a generous budget", () => {
    for (const id of HARD_TASK_IDS) {
      const task = taskById(id);
      expect(task.timeoutMs, id).toBeGreaterThanOrEqual(480_000);
      expect(task.measures.length, id).toBeGreaterThan(0);
    }
  });
});

// ── parser-spec: the graded blocks must exist in the hidden suite ────────────

describe("parser-spec answer key", () => {
  it("grades exactly the describe blocks the hidden suite declares", async () => {
    const source = await fs.readFile(
      path.join(FIXTURE_ROOT, "parser-spec", ".hidden", "expr.test.ts"),
      "utf8",
    );
    const declared = [...source.matchAll(/^describe\("([^"]+)"/gm)].map((match) => match[1]);
    expect(declared).toEqual(EXPR_BLOCKS.map((entry) => entry.block));
  });

  it("weights the error-offset block above the rest", () => {
    const offsets = EXPR_BLOCKS.find((entry) => entry.check === "error-offsets");
    expect(offsets?.weight).toBe(2);
  });
});

// ── perf-refactor: the pristine API the grader pins ─────────────────────────

describe("perf-refactor answer key", () => {
  it("pins the two exports the fixture actually ships", async () => {
    const source = await fs.readFile(
      path.join(FIXTURE_ROOT, "perf-refactor", "src", "index.ts"),
      "utf8",
    );
    const exports = [...source.matchAll(/^export function (\w+)\(([^)]*)\)/gm)];
    expect(exports.map((match) => match[1])).toEqual(["findPairs", "groupAnagrams"]);
    expect(exports[0]?.[2]?.split(",")).toHaveLength(2);
    expect(exports[1]?.[2]?.split(",")).toHaveLength(1);
  });

  it("declares the two blocks the grader runs separately", async () => {
    const source = await fs.readFile(
      path.join(FIXTURE_ROOT, "perf-refactor", ".hidden", "perf.test.ts"),
      "utf8",
    );
    const declared = [...source.matchAll(/^describe\("([^"]+)"/gm)].map((match) => match[1]);
    expect(declared).toEqual(["correctness", "scale"]);
  });
});

// ── multi-bug: five red files, five independent bugs ────────────────────────

describe("multi-bug fixture", () => {
  it("ships exactly five test files, one per bug", async () => {
    const files = await fs.readdir(path.join(FIXTURE_ROOT, "multi-bug", "test"));
    expect(files.toSorted()).toEqual([
      "lookup.test.ts",
      "pricing.test.ts",
      "range.test.ts",
      "rank.test.ts",
      "registry.test.ts",
    ]);
  });

  it("keeps every bug in its own source module", async () => {
    const files = await fs.readdir(path.join(FIXTURE_ROOT, "multi-bug", "src"));
    expect(files.length).toBeGreaterThanOrEqual(7);
  });
});

// ── deep-search: the answer key and the structure it depends on ─────────────

/** Every `.ts` file under `<fixture>/src`, as repo-relative posix paths. */
async function fixtureSources(fixture: string): Promise<string[]> {
  const root = path.join(FIXTURE_ROOT, fixture);
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const found: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...(await walk(full)));
      else if (entry.name.endsWith(".ts"))
        found.push(path.relative(root, full).split(path.sep).join("/"));
    }
    return found;
  };
  return (await walk(path.join(root, "src"))).toSorted();
}

/** The module import graph of a fixture, keyed by repo-relative posix path. */
async function importGraph(fixture: string): Promise<Map<string, string[]>> {
  const root = path.join(FIXTURE_ROOT, fixture);
  const graph = new Map<string, string[]>();
  for (const rel of await fixtureSources(fixture)) {
    const source = await fs.readFile(path.join(root, rel), "utf8");
    const deps: string[] = [];
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const spec = match[1];
      if (spec === undefined) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      deps.push(target);
    }
    graph.set(rel, deps);
  }
  return graph;
}

describe("deep-search answer key", () => {
  it("points at a line that really performs the read", async () => {
    const source = await fs.readFile(
      path.join(FIXTURE_ROOT, "deep-search", DEEP_SEARCH_ANSWER.file),
      "utf8",
    );
    const line = source.split("\n")[DEEP_SEARCH_ANSWER.line - 1] ?? "";
    expect(line).toContain(DEEP_SEARCH_ANSWER.reads);
  });

  it("names a function src/api/index.ts actually exports", async () => {
    const source = await fs.readFile(
      path.join(FIXTURE_ROOT, "deep-search", "src", "api", "index.ts"),
      "utf8",
    );
    expect(source).toMatch(
      new RegExp(`^export function ${DEEP_SEARCH_ANSWER.functionName}\\(`, "m"),
    );
  });

  it("plants exactly one decoy read of PAYMENT_MODE, in an unreachable module", async () => {
    const files = await fixtureSources("deep-search");
    const readers: string[] = [];
    for (const rel of files) {
      const source = await fs.readFile(path.join(FIXTURE_ROOT, "deep-search", rel), "utf8");
      if (source.includes(DEEP_SEARCH_ANSWER.reads)) readers.push(rel);
    }
    expect(readers.toSorted()).toEqual(
      [DEEP_SEARCH_ANSWER.file, DEEP_SEARCH_ANSWER.decoyFile].toSorted(),
    );

    const graph = await importGraph("deep-search");
    const seen = new Set<string>();
    const stack = ["src/api/index.ts"];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      stack.push(...(graph.get(current) ?? []));
    }
    expect(seen.has(DEEP_SEARCH_ANSWER.file)).toBe(true);
    expect(seen.has(DEEP_SEARCH_ANSWER.decoyFile)).toBe(false);
  });

  it("routes the answer through a barrel and an aliased import, over four or more hops", async () => {
    const chain = DEEP_SEARCH_ANSWER.chain;
    expect(chain.length - 1).toBeGreaterThanOrEqual(4);
    expect(chain).toContain("src/services/index.ts");

    const graph = await importGraph("deep-search");
    for (let index = 0; index < chain.length - 1; index++) {
      const from = chain[index]!;
      const to = chain[index + 1]!;
      expect(graph.get(from), `${from} -> ${to}`).toContain(to);
    }

    let aliased = 0;
    for (const rel of chain) {
      const source = await fs.readFile(path.join(FIXTURE_ROOT, "deep-search", rel), "utf8");
      aliased += [...source.matchAll(/import\s*\{[^}]*\bas\b[^}]*\}/g)].length;
    }
    expect(aliased).toBeGreaterThanOrEqual(1);
  });

  it("plants at least four other process.env reads", async () => {
    const files = await fixtureSources("deep-search");
    const others = new Set<string>();
    for (const rel of files) {
      const source = await fs.readFile(path.join(FIXTURE_ROOT, "deep-search", rel), "utf8");
      for (const match of source.matchAll(/process\.env\.(\w+)/g)) {
        if (match[1] !== "PAYMENT_MODE") others.add(match[1]!);
      }
    }
    expect(others.size).toBeGreaterThanOrEqual(4);
  });
});

describe("deep-search grader", () => {
  const correct = `${DEEP_SEARCH_ANSWER.functionName} ${DEEP_SEARCH_ANSWER.file}:${DEEP_SEARCH_ANSWER.line}`;

  it("passes the demanded one-line answer", async () => {
    const grade = await withTempDir((dir) =>
      taskById("deep-search").grade(emptyContext(dir, { finalText: correct })),
    );
    expect(grade.passed).toBe(true);
    expect(grade.score).toBe(1);
  });

  it("tolerates backticks and a trailing newline", async () => {
    const grade = await withTempDir((dir) =>
      taskById("deep-search").grade(emptyContext(dir, { finalText: `\`${correct}\`\n` })),
    );
    expect(grade.passed).toBe(true);
  });

  it("gives file-only credit for the right module at the wrong line", async () => {
    const grade = await withTempDir((dir) =>
      taskById("deep-search").grade(
        emptyContext(dir, {
          finalText: `${DEEP_SEARCH_ANSWER.functionName} src/config/env-source.ts:13`,
        }),
      ),
    );
    expect(grade.passed).toBe(false);
    expect(grade.score).toBeCloseTo(4 / 7);
  });

  it("scores 0 for the decoy module and the wrong function", async () => {
    const grade = await withTempDir((dir) =>
      taskById("deep-search").grade(
        emptyContext(dir, { finalText: `gatewayLabel ${DEEP_SEARCH_ANSWER.decoyFile}:8` }),
      ),
    );
    expect(grade.score).toBe(0);
  });
});

// ── the house-rules JSDoc check ──────────────────────────────────────────────

/** Grades a synthetic `src/csv.ts` through the real house-rules grader and
 *  returns just the `jsdoc-on-export` check. */
async function jsdocCheck(body: string): Promise<boolean> {
  const grade = await withTempDir((dir) =>
    taskById("house-rules").grade(
      emptyContext(dir, { readFile: async (rel) => (rel === "src/csv.ts" ? body : null) }),
    ),
  );
  return grade.checks.find((entry) => entry.name === "jsdoc-on-export")?.ok === true;
}

const EXPORT_LINE = "export function toCsv(rows: Row[]): string {\n  return '';\n}\n";

describe("house-rules jsdoc-on-export", () => {
  it("accepts a multi-line /** */ block", async () => {
    expect(await jsdocCheck(`/**\n * Encodes rows as CSV.\n */\n${EXPORT_LINE}`)).toBe(true);
  });

  it("accepts a single-line /** */ block", async () => {
    expect(await jsdocCheck(`/** Encodes rows as CSV. */\n${EXPORT_LINE}`)).toBe(true);
  });

  it("still accepts a blank line between the block and the export", async () => {
    expect(await jsdocCheck(`/**\n * Encodes rows as CSV.\n */\n\n\n${EXPORT_LINE}`)).toBe(true);
  });

  it("rejects a plain /* */ block, single-line and multi-line", async () => {
    expect(await jsdocCheck(`/* not jsdoc */\n${EXPORT_LINE}`)).toBe(false);
    expect(await jsdocCheck(`/*\n * not jsdoc\n */\n${EXPORT_LINE}`)).toBe(false);
  });

  it("rejects a // line comment", async () => {
    expect(await jsdocCheck(`// not jsdoc\n${EXPORT_LINE}`)).toBe(false);
  });

  it("rejects no comment at all", async () => {
    expect(await jsdocCheck(EXPORT_LINE)).toBe(false);
  });
});

// ── golden solutions ─────────────────────────────────────────────────────────

/**
 * The reference solutions committed under `fixtures/bench/<task>/.solution/`,
 * graded through the real grader in a real sandbox.
 *
 * A silently-broken file grader and a genuinely perfect run produce the same
 * 1.00, so an empty-sandbox `score === 0` test proves nothing on its own. Each
 * task below scores its golden solution (must be exactly 1) and then one
 * targeted mutation of it (must land strictly between 0 and 1), which is what
 * pins each individual check to something it actually discriminates.
 */

/** Every file-based grader — the text-only ones are covered above. */
const GOLDEN_TASK_IDS = [
  "fix-failing-test",
  "implement-spec",
  "thread-field",
  "house-rules",
  "parser-spec",
  "perf-refactor",
  "multi-bug",
] as const;

/** Generous: `perf-refactor` runs a 500k-element scale check, and its negative
 *  control is deliberately quadratic and killed by the grader's own timeout. */
const GOLDEN_TIMEOUT_MS = 300_000;

async function overlay(from: string, to: string): Promise<void> {
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(destination, { recursive: true });
      await overlay(source, destination);
    } else if (entry.isFile()) {
      await fs.copyFile(source, destination);
    }
  }
}

/**
 * A sandbox built exactly the way a real run builds one — `createSandbox`, then
 * `revealHidden` — with `.solution/` overlaid in place of the agent's work.
 */
async function goldenSandbox(task: BenchTask, suffix: string): Promise<string> {
  const dir = await createSandbox({
    suiteId: `golden-${suffix}`,
    modelId: "golden",
    taskId: task.id,
    attempt: 1,
    fixtureRoot: FIXTURE_ROOT,
    fixture: task.fixture,
  });
  await overlay(path.join(FIXTURE_ROOT, task.fixture, ".solution"), dir);
  await revealHidden(dir, FIXTURE_ROOT, task.fixture, task.hidden);
  return dir;
}

/** Builds the golden sandbox, optionally breaks it, grades it, then removes it. */
async function gradeGolden(
  id: string,
  suffix: string,
  mutate?: (dir: string) => Promise<void>,
): Promise<TaskGrade> {
  const task = taskById(id);
  const dir = await goldenSandbox(task, suffix);
  try {
    if (mutate) await mutate(dir);
    return await task.grade(makeGradeContext(dir, "", stubMetrics()));
  } finally {
    await removeSandbox(dir);
  }
}

async function patch(
  dir: string,
  relPath: string,
  edit: (source: string) => string,
): Promise<void> {
  const absPath = path.join(dir, relPath);
  await fs.writeFile(absPath, edit(await fs.readFile(absPath, "utf8")), "utf8");
}

async function revert(dir: string, fixture: string, relPath: string): Promise<void> {
  await fs.copyFile(path.join(FIXTURE_ROOT, fixture, relPath), path.join(dir, relPath));
}

describe("golden solutions", () => {
  it("ships a .solution/ for every file-based grader", async () => {
    for (const id of GOLDEN_TASK_IDS) {
      const task = taskById(id);
      expect(
        await exists(path.join(FIXTURE_ROOT, task.fixture, ".solution")),
        `${task.fixture}/.solution`,
      ).toBe(true);
    }
  });

  it("keeps .solution/ and .hidden/ out of the sandbox copy", async () => {
    const task = taskById("house-rules");
    const dir = await createSandbox({
      suiteId: "golden-exclusion",
      modelId: "golden",
      taskId: task.id,
      attempt: 1,
      fixtureRoot: FIXTURE_ROOT,
      fixture: task.fixture,
    });
    try {
      expect(SANDBOX_EXCLUDED_DIRS).toEqual([".hidden", ".solution"]);
      expect(await exists(path.join(dir, ".solution"))).toBe(false);
      expect(await exists(path.join(dir, ".hidden"))).toBe(false);
      // The rest of the fixture is still there.
      expect(await exists(path.join(dir, "src", "rows.ts"))).toBe(true);
    } finally {
      await removeSandbox(dir);
    }
  });

  for (const id of GOLDEN_TASK_IDS) {
    it(
      `${id} scores 1.00 on its reference solution`,
      async () => {
        const grade = await gradeGolden(id, "pass");
        const failed = grade.checks.filter((entry) => !entry.ok);
        expect(failed.map((entry) => `${entry.name}: ${entry.detail ?? ""}`)).toEqual([]);
        expect(grade.score).toBe(1);
        expect(grade.passed).toBe(true);
      },
      GOLDEN_TIMEOUT_MS,
    );
  }
});

describe("golden solutions, mutated", () => {
  it(
    "fix-failing-test: re-breaking the rounding bug fails only the suite check",
    async () => {
      const grade = await gradeGolden("fix-failing-test", "mut", (dir) =>
        revert(dir, "fix-failing-test", "src/money.ts"),
      );
      expect(grade.passed).toBe(false);
      // suite-green (4) lost; tests-untouched (3) + no-test-deleted (2) kept.
      expect(grade.score).toBeCloseTo(5 / 9);
    },
    GOLDEN_TIMEOUT_MS,
  );

  it(
    "implement-spec: a declared dependency costs the no-new-deps check",
    async () => {
      const grade = await gradeGolden("implement-spec", "mut", (dir) =>
        patch(dir, "package.json", (source) =>
          source.replace('"type": "module"', '"type": "module",\n  "dependencies": {}'),
        ),
      );
      expect(grade.passed).toBe(false);
      // file-exists (1) + hidden-suite (5) kept; no-new-deps (1) lost.
      expect(grade.score).toBeCloseTo(6 / 7);
    },
    GOLDEN_TIMEOUT_MS,
  );

  it(
    "thread-field: leaving report.ts alone costs the hidden suite and the touch check",
    async () => {
      const grade = await gradeGolden("thread-field", "mut", (dir) =>
        revert(dir, "thread-field", "src/report.ts"),
      );
      expect(grade.passed).toBe(false);
      expect(grade.score).toBeGreaterThan(0);
      expect(grade.score).toBeLessThan(1);
      // The existing suite is behaviour-preserving, so it must still be green.
      expect(grade.checks.find((c) => c.name === "existing-suite-still-green")?.ok).toBe(true);
      expect(grade.checks.find((c) => c.name === "all-three-touched")?.ok).toBe(false);
    },
    GOLDEN_TIMEOUT_MS,
  );

  it(
    "house-rules: console.log instead of the logger costs only uses-logger",
    async () => {
      const grade = await gradeGolden("house-rules", "mut", (dir) =>
        patch(dir, "src/csv.ts", (source) =>
          source
            .replace('import { log } from "./log.ts";\n', "")
            .replace(/log\(\s*"warn",/, "console.warn("),
        ),
      );
      expect(grade.passed).toBe(false);
      expect(grade.checks.find((c) => c.name === "uses-logger")?.ok).toBe(false);
      expect(grade.checks.find((c) => c.name === "hidden-suite")?.ok).toBe(true);
      expect(grade.checks.find((c) => c.name === "jsdoc-on-export")?.ok).toBe(true);
      // hidden-suite (4) + no-any (2) + jsdoc (1) kept; uses-logger (2) lost.
      expect(grade.score).toBeCloseTo(7 / 9);
    },
    GOLDEN_TIMEOUT_MS,
  );

  it(
    "parser-spec: dropping the offsets from the error messages costs that block only",
    async () => {
      const grade = await gradeGolden("parser-spec", "mut", (dir) =>
        patch(dir, "src/expr.ts", (source) =>
          source.replaceAll(" at ${src.length}", "").replaceAll(" at ${pos}", ""),
        ),
      );
      expect(grade.passed).toBe(false);
      expect(grade.checks.find((c) => c.name === "error-offsets")?.ok).toBe(false);
      for (const name of ["precedence", "unary-and-nesting", "decimals-and-whitespace"]) {
        expect(grade.checks.find((c) => c.name === name)?.ok, name).toBe(true);
      }
      // Everything but error-offsets (2) of 7 total weight.
      expect(grade.score).toBeCloseTo(5 / 7);
    },
    GOLDEN_TIMEOUT_MS,
  );

  it(
    "perf-refactor: leaving groupAnagrams quadratic costs the scale budget",
    async () => {
      const grade = await gradeGolden("perf-refactor", "mut", async (dir) => {
        const pristine = await fs.readFile(
          path.join(FIXTURE_ROOT, "perf-refactor", "src/index.ts"),
          "utf8",
        );
        const marker = "export function groupAnagrams";
        await patch(dir, "src/index.ts", (source) =>
          source.slice(0, source.indexOf(marker)).concat(pristine.slice(pristine.indexOf(marker))),
        );
      });
      expect(grade.passed).toBe(false);
      expect(grade.checks.find((c) => c.name === "scale-budget")?.ok).toBe(false);
      // api-unchanged (1) + visible-suite (2) + hidden-correctness (3) kept.
      expect(grade.score).toBeCloseTo(6 / 9);
    },
    GOLDEN_TIMEOUT_MS,
  );

  it(
    "multi-bug: reverting two of the five fixes costs exactly those two suites",
    async () => {
      const grade = await gradeGolden("multi-bug", "mut", async (dir) => {
        await revert(dir, "multi-bug", "src/pricing.ts");
        await revert(dir, "multi-bug", "src/rank.ts");
      });
      expect(grade.passed).toBe(false);
      expect(grade.checks.find((c) => c.name === "suite-pricing")?.ok).toBe(false);
      expect(grade.checks.find((c) => c.name === "suite-rank")?.ok).toBe(false);
      expect(grade.checks.find((c) => c.name === "tests-untouched")?.ok).toBe(true);
      // 3 of 5 suites (1 each) + tests-untouched (3), of 8 total weight.
      expect(grade.score).toBeCloseTo(6 / 8);
    },
    GOLDEN_TIMEOUT_MS,
  );
});
