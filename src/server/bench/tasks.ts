/**
 * The ccbench task registry.
 *
 * Six tasks, one per thing that actually decides whether a model can drive
 * Claude Code: find code, recover from a red suite, write to a spec, keep
 * several files coherent, use tools well, and obey the project's own rules.
 *
 * Every grader here is deterministic and offline — files, exit codes and
 * transcript metrics only. Nothing grades the model's prose about its own work,
 * because a model that confidently claims success is exactly what we are trying
 * to measure against.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchCheck, BenchTask, CommandResult, GradeContext, TaskGrade } from "./types.js";

/** Absolute path to `<repo>/fixtures/bench`. */
export const FIXTURE_ROOT: string = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/bench",
);

/** The verified location of the `locate` task's target function, `path:line`. */
export const LOCATE_ANSWER = {
  file: "src/report/currency.ts",
  line: 7,
  symbol: "formatCentsAsEuro",
} as const;

const LOCATE_TARGET = `${LOCATE_ANSWER.file}:${LOCATE_ANSWER.line}`;

// ── grading helpers ──────────────────────────────────────────────────────────

/** Builds a check, attaching `detail` only when it failed — that is when the
 *  report has something to explain. */
function check(name: string, ok: boolean, weight: number, detail: string): BenchCheck {
  return ok ? { name, ok, weight } : { name, ok, weight, detail };
}

/** Weighted mean of `checks`; passes only when every weighted check passed. */
function gradeFrom(checks: BenchCheck[]): TaskGrade {
  const total = checks.reduce((sum, c) => sum + (c.weight ?? 1), 0);
  const earned = checks.reduce((sum, c) => sum + (c.ok ? (c.weight ?? 1) : 0), 0);
  return {
    score: total === 0 ? 0 : earned / total,
    passed: checks.length > 0 && checks.every((c) => (c.weight ?? 1) === 0 || c.ok),
    checks,
  };
}

/** Reads a file from the pristine fixture; null when missing. */
async function readPristine(fixture: string, relPath: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(FIXTURE_ROOT, fixture, relPath), "utf8");
  } catch {
    return null;
  }
}

/** Every file under `<fixture>/<relDir>`, as paths relative to `relDir`, sorted. */
async function listPristine(fixture: string, relDir: string): Promise<string[]> {
  const root = path.join(FIXTURE_ROOT, fixture, relDir);
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const found: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...(await walk(full)));
      else found.push(path.relative(root, full));
    }
    return found;
  };
  return (await walk(root)).toSorted();
}

/** Strips block and line comments so a rule check never trips on prose. */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, " ").replaceAll(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The last balanced top-level JSON object in `text`, tolerating fences and prose. */
function extractLastJsonObject(text: string): Record<string, unknown> | null {
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) spans.push([start, i + 1]);
    }
  }

  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i];
    if (!span) continue;
    try {
      const parsed: unknown = JSON.parse(text.slice(span[0], span[1]));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON after all — fall through to the previous candidate.
    }
  }
  return null;
}

// ── 1. locate ────────────────────────────────────────────────────────────────

/** Trims the answer down to a bare `path:line`, forgiving quoting and `./`. */
function normalizeLocation(text: string): string {
  return text
    .trim()
    .replaceAll(/^[`'"\s]+/g, "")
    .replaceAll(/[`'"\s.]+$/g, "")
    .replace(/^\.\//, "");
}

/** The file part of the last `path:line` token in `text`, or null. */
function lastReferencedFile(text: string): string | null {
  const referenced = [...text.matchAll(/([\w./-]+\.tsx?):(\d+)/g)].at(-1)?.[1];
  if (referenced) return referenced.replace(/^\.\//, "");
  const bare = normalizeLocation(text);
  return /\.tsx?$/.test(bare) ? bare : null;
}

const locate: BenchTask = {
  id: "locate",
  title: "Find the cents-to-euro formatter",
  measures: ["search"],
  fixture: "locate",
  prompt: [
    "This repository is a small TypeScript package. Exactly one function in it converts a price",
    'given as an integer number of cents into a formatted euro string (for example 1234 -> "12,34 €").',
    "",
    "Find that function and answer with its location as `path:line`, where `path` is the file path",
    "relative to the repository root and `line` is the 1-based line number of the line that declares",
    "the function (the `export function ...` line itself).",
    "",
    "Your final message must be that single `path:line` token and nothing else — no prose, no",
    "backticks, no code fence, no explanation.",
  ].join("\n"),
  maxTurns: 15,
  timeoutMs: 240_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const answer = normalizeLocation(ctx.finalText);
    const file = lastReferencedFile(ctx.finalText);
    return gradeFrom([
      check(
        "exact-location",
        answer === LOCATE_TARGET,
        4,
        `expected exactly "${LOCATE_TARGET}", got "${answer.slice(0, 200)}"`,
      ),
      check(
        "file-correct",
        file === LOCATE_ANSWER.file,
        1,
        `expected the answer to point at ${LOCATE_ANSWER.file}, got ${file ?? "no file path"}`,
      ),
    ]);
  },
};

// ── 2. fix-failing-test ──────────────────────────────────────────────────────

const fixFailingTest: BenchTask = {
  id: "fix-failing-test",
  title: "Make a red suite green without touching the tests",
  measures: ["recovery", "coding"],
  fixture: "fix-failing-test",
  prompt: [
    "The test suite in this package is failing. Run `bun test`, work out why, and make the whole",
    "suite pass.",
    "",
    "Both failures are caused by real bugs in the source under `src/`. The tests are correct and",
    "describe the intended behaviour — do not bend them to the code.",
    "",
    "Do not modify, delete, move or add anything under `test/`. Fix `src/` only. When you are done,",
    "run `bun test` once more and confirm it is green.",
  ].join("\n"),
  maxTurns: 30,
  timeoutMs: 420_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const suite = await ctx.run(["bun", "test"]);
    const testFiles = await listPristine("fix-failing-test", "test");

    const missing: string[] = [];
    const changed: string[] = [];
    for (const rel of testFiles) {
      const sandboxPath = path.posix.join("test", rel);
      const actual = await ctx.readFile(sandboxPath);
      if (actual === null) {
        missing.push(sandboxPath);
        continue;
      }
      const pristine = await readPristine("fix-failing-test", sandboxPath);
      if (pristine !== null && actual !== pristine) changed.push(sandboxPath);
    }

    return gradeFrom([
      check(
        "suite-green",
        suite.code === 0,
        4,
        `bun test exited ${suite.code}${suite.timedOut ? " (timed out)" : ""}: ${(
          suite.stderr || suite.stdout
        )
          .trim()
          .slice(-600)}`,
      ),
      check(
        "tests-untouched",
        testFiles.length > 0 && changed.length === 0 && missing.length === 0,
        3,
        `test files no longer byte-identical to the fixture: ${[...changed, ...missing].join(", ")}`,
      ),
      check(
        "no-test-deleted",
        testFiles.length > 0 && missing.length === 0,
        2,
        testFiles.length === 0
          ? "no pristine test files found — fixture is broken"
          : `test files were deleted: ${missing.join(", ")}`,
      ),
    ]);
  },
};

// ── 3. implement-spec ────────────────────────────────────────────────────────

const implementSpec: BenchTask = {
  id: "implement-spec",
  title: "Implement parseDuration to a written spec",
  measures: ["coding"],
  fixture: "implement-spec",
  hidden: { "duration.test.ts": "test/duration.test.ts" },
  prompt: [
    "Add a duration parser to this package.",
    "",
    "Create `src/duration.ts` and export a function `parseDuration(input: string): number` that turns",
    "a duration string into a whole number of milliseconds.",
    "",
    "Accepted input is `<number><unit>`:",
    "- `<number>` is a non-negative integer or decimal, e.g. `30` or `1.5`. No sign, no exponent.",
    "- `<unit>` is one of `ms`, `s`, `m`, `h`, `d`, matched case-insensitively. `m` means minutes and",
    "  `ms` means milliseconds.",
    "- There is no whitespace between the number and the unit. Leading and trailing whitespace around",
    "  the whole string is allowed and ignored.",
    "",
    'Exact examples: `parseDuration("1.5h")` returns `5400000`. `parseDuration("  250MS  ")` returns `250`.',
    "",
    "Anything else throws a `TypeError`: an empty or whitespace-only string, a number with no unit",
    '(`"10"`), an unknown unit (`"10x"`), a negative amount (`"-5s"`), a space between the number and',
    'the unit (`"10 s"`), and non-numeric input (`"abc"`, `"NaN"`).',
    "",
    "Also add your own test for it under `test/`. Do not add any dependency to `package.json` —",
    "bun's built-in test runner and the standard library are enough.",
  ].join("\n"),
  maxTurns: 25,
  timeoutMs: 360_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const source = await ctx.readFile("src/duration.ts");
    const suite = await ctx.run(["bun", "test", "test/duration.test.ts"]);
    const manifest = await ctx.readFile("package.json");

    let depsClean = false;
    let depsDetail = "package.json is missing from the sandbox";
    if (manifest !== null) {
      try {
        const parsed: unknown = JSON.parse(manifest);
        const record = parsed as Record<string, unknown>;
        const added = ["dependencies", "devDependencies", "peerDependencies"].filter(
          (key) => record[key] !== undefined,
        );
        depsClean = added.length === 0;
        depsDetail = `package.json gained ${added.join(", ")}`;
      } catch {
        depsDetail = "package.json is no longer valid JSON";
      }
    }

    return gradeFrom([
      check("file-exists", source !== null, 1, "src/duration.ts was never created"),
      check(
        "hidden-suite",
        suite.code === 0,
        5,
        `hidden suite exited ${suite.code}${suite.timedOut ? " (timed out)" : ""}: ${(
          suite.stderr || suite.stdout
        )
          .trim()
          .slice(-600)}`,
      ),
      check("no-new-deps", depsClean, 1, depsDetail),
    ]);
  },
};

// ── 4. thread-field ──────────────────────────────────────────────────────────

const THREAD_FIELD_FILES = ["src/types.ts", "src/mapper.ts", "src/report.ts"];

const threadField: BenchTask = {
  id: "thread-field",
  title: "Thread a discount field through three files",
  measures: ["multi_file", "coding"],
  fixture: "thread-field",
  hidden: { "discount.test.ts": "test/discount.test.ts" },
  prompt: [
    "Thread a new `discountCents` field through this package, end to end.",
    "",
    "1. `src/types.ts` — `Order` gains a required `discountCents: number`. The raw export shape",
    "   `RawOrder` carries it as an optional `discount_cents`, which may be a number, `null`, or",
    "   absent entirely.",
    "2. `src/mapper.ts` — `toOrder` populates `discountCents` from `discount_cents`, defaulting to",
    "   `0` when the raw field is absent or `null`.",
    "3. `src/report.ts` — when `discountCents` is greater than zero, `orderLine` appends",
    "   ` (discount <amount>)` to the line it already produces, where `<amount>` is the discount",
    "   rendered by the existing `formatCents` helper. When `discountCents` is zero the line is",
    "   unchanged.",
    "",
    "Exact example — this call:",
    "",
    '  orderLine(toOrder({ id: "B-7", customer_name: "Bob", total_cents: 5000, discount_cents: 250 }))',
    "",
    "must return exactly:",
    "",
    "  B-7 | Bob | 50,00 € (discount 2,50 €)",
    "",
    "Do not modify anything under `test/`. The existing suite must stay green — run `bun test`.",
  ].join("\n"),
  maxTurns: 30,
  timeoutMs: 420_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const hidden = await ctx.run(["bun", "test", "test/discount.test.ts"]);
    const existing = await ctx.run(["bun", "test", "test/report.test.ts"]);

    const untouched: string[] = [];
    for (const rel of THREAD_FIELD_FILES) {
      const actual = await ctx.readFile(rel);
      const pristine = await readPristine("thread-field", rel);
      if (actual === null || actual === pristine) untouched.push(rel);
    }

    return gradeFrom([
      check(
        "hidden-suite",
        hidden.code === 0,
        5,
        `hidden suite exited ${hidden.code}${hidden.timedOut ? " (timed out)" : ""}: ${(
          hidden.stderr || hidden.stdout
        )
          .trim()
          .slice(-600)}`,
      ),
      check(
        "existing-suite-still-green",
        existing.code === 0,
        2,
        `test/report.test.ts exited ${existing.code}: ${(existing.stderr || existing.stdout)
          .trim()
          .slice(-600)}`,
      ),
      check(
        "all-three-touched",
        untouched.length === 0,
        1,
        `left unchanged or missing: ${untouched.join(", ")}`,
      ),
    ]);
  },
};

// ── 5. batch-read ────────────────────────────────────────────────────────────

/** The tokens planted in `fixtures/bench/batch-read/notes/*.md`. */
const BATCH_READ_TOKENS: Record<string, string> = {
  "a.md": "KX7-QQ2-9F1",
  "b.md": "MB4-TT8-3D6",
  "c.md": "RZ9-LN5-7A2",
  "d.md": "PW2-HJ6-4C8",
  "e.md": "VD5-XS3-1E7",
  "f.md": "GQ8-YK1-6B4",
};

const batchRead: BenchTask = {
  id: "batch-read",
  title: "Collect six tokens in as few round-trips as possible",
  measures: ["tool_use"],
  fixture: "batch-read",
  prompt: [
    "This directory holds six notes, `notes/a.md` through `notes/f.md`. Each one contains a line of",
    "the form `token: <TOKEN>`.",
    "",
    "Read all six and report a single JSON object mapping each note's file name to its token — six",
    'entries, keyed `"a.md"` through `"f.md"`, for example {"a.md": "AAA-BBB-CCC", ...}.',
    "",
    "Your final message must be only that JSON object — no prose, no code fence, no explanation.",
  ].join("\n"),
  maxTurns: 15,
  timeoutMs: 240_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const parsed = extractLastJsonObject(ctx.finalText);
    const wrong: string[] = [];
    for (const [file, token] of Object.entries(BATCH_READ_TOKENS)) {
      const got = parsed?.[file];
      if (got !== token) wrong.push(`${file}: expected ${token}, got ${String(got)}`);
    }

    return gradeFrom([
      check(
        "tokens-correct",
        parsed !== null && wrong.length === 0,
        4,
        parsed === null
          ? "no JSON object in the final message"
          : `wrong or missing tokens — ${wrong.join("; ")}`,
      ),
      // Six serial Reads is the failure this measures. Batching three or more
      // into one assistant message is the expected way out — but a single
      // `cat`-them-all Bash call is strictly better than either, and the first
      // version of this check scored it as a miss. Reward whichever route
      // avoided six round-trips; only serialising them counts against a model.
      check(
        "efficient-reads",
        ctx.metrics.maxParallelWidth >= 3 ||
          (ctx.metrics.toolCalls > 0 && ctx.metrics.toolCalls <= 2),
        2,
        `six files took ${ctx.metrics.toolCalls} tool call(s) with a widest parallel batch of ${ctx.metrics.maxParallelWidth} — expected either a batch of 3+ or a single command covering all six`,
      ),
      check(
        "no-tool-errors",
        ctx.metrics.toolCalls > 0 && ctx.metrics.toolErrors === 0,
        1,
        ctx.metrics.toolCalls === 0
          ? "the agent made no tool calls at all"
          : `${ctx.metrics.toolErrors} tool call(s) returned an error`,
      ),
    ]);
  },
};

// ── 6. house-rules ───────────────────────────────────────────────────────────

const ANY_PATTERNS: RegExp[] = [
  /:\s*any\b/,
  /\bas\s+any\b/,
  /<\s*any\s*[,>]/,
  /\bany\s*\[\]/,
  /\bany\s*\|/,
  /\|\s*any\b/,
];

/**
 * True when a real `/** ... *\/` block sits directly above the exported symbol.
 *
 * "Ends with `*\/`" is not enough: a plain `/* not jsdoc *\/` block would satisfy
 * it while breaking the rule the fixture's CLAUDE.md states, which is exactly
 * the grader-gaming this benchmark exists to detect. So the closing line is
 * traced back to the line that opened the block, and that line must start with
 * `/**`. Both the one-line and the multi-line form are accepted; a `//` comment
 * is not a JSDoc block and never satisfies it.
 */
function hasJsdocAboveExport(source: string, symbol: string): boolean {
  const lines = source.split("\n");
  const declaration = new RegExp(
    `^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class)\\s+${symbol}\\b`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (!declaration.test(lines[i] ?? "")) continue;

    let closing = i - 1;
    while (closing >= 0 && (lines[closing] ?? "").trim() === "") closing--;
    if (closing < 0) return false;

    const closingLine = (lines[closing] ?? "").trim();
    if (!closingLine.endsWith("*/")) return false;
    // `/** one liner */` — opener and closer on the same line.
    if (closingLine.startsWith("/**")) return true;

    for (let opening = closing; opening >= 0; opening--) {
      const line = (lines[opening] ?? "").trim();
      if (line.startsWith("/**")) return true;
      // A `/*` that is not `/**` opens this block: a comment, not a doc block.
      if (line.startsWith("/*")) return false;
    }
    return false;
  }
  return false;
}

const houseRules: BenchTask = {
  id: "house-rules",
  title: "Write a CSV encoder that obeys the project's rules unprompted",
  measures: ["adherence", "coding"],
  fixture: "house-rules",
  hidden: { "csv.test.ts": "test/csv.test.ts" },
  prompt: [
    "Add a CSV writer to this package.",
    "",
    "Create `src/csv.ts` and export `toCsv(rows: Row[]): string`, where `Row` is the type already",
    "exported from `src/rows.ts`.",
    "",
    "The output is:",
    "- a header line, exactly `id,name,email`;",
    "- one line per row, holding that row's `id`, `name` and `email` values in that order — any other",
    "  column on the row is ignored;",
    "- lines joined with a single `\\n`, with no trailing newline.",
    "",
    "Field rules:",
    "- a missing, `null` or `undefined` value is written as an empty field;",
    "- a number is written as `String(value)`;",
    '- a field is wrapped in double quotes only when its text contains a comma, a `"`, or a newline,',
    '  and inside a quoted field every `"` is doubled. Otherwise it is written bare.',
    "",
    "For every row that is missing at least one of the three required columns, emit exactly one",
    "warning naming that row's `id` and the columns it is missing.",
    "",
    "Add a test for it under `test/`.",
  ].join("\n"),
  maxTurns: 30,
  timeoutMs: 420_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const suite = await ctx.run(["bun", "test", "test/csv.test.ts"]);
    const raw = await ctx.readFile("src/csv.ts");
    const source = raw === null ? "" : stripComments(raw);

    const anyHit = ANY_PATTERNS.find((pattern) => pattern.test(source));
    const usesConsole = /\bconsole\s*\./.test(source);
    const importsLog = /from\s*["']\.\/log(?:\.[tj]s)?["']/.test(source);
    const callsLog = /\blog\s*\(/.test(source);

    return gradeFrom([
      check(
        "hidden-suite",
        suite.code === 0,
        4,
        `hidden suite exited ${suite.code}${suite.timedOut ? " (timed out)" : ""}: ${(
          suite.stderr || suite.stdout
        )
          .trim()
          .slice(-600)}`,
      ),
      check(
        "no-any",
        raw !== null && anyHit === undefined,
        2,
        raw === null
          ? "src/csv.ts was never created"
          : `src/csv.ts uses the any type (matched ${String(anyHit)})`,
      ),
      check(
        "jsdoc-on-export",
        raw !== null && hasJsdocAboveExport(raw, "toCsv"),
        1,
        raw === null
          ? "src/csv.ts was never created"
          : "no /** ... */ block directly above the exported toCsv",
      ),
      check(
        "uses-logger",
        raw !== null && !usesConsole && importsLog && callsLog,
        2,
        raw === null
          ? "src/csv.ts was never created"
          : usesConsole
            ? "src/csv.ts calls console.* instead of log()"
            : "src/csv.ts does not import and call log() from ./log",
      ),
    ]);
  },
};

// ── shared helpers for the hard tier ─────────────────────────────────────────

/** Compares every file under `<fixture>/test` with the sandbox copy. */
async function compareTestTree(
  ctx: GradeContext,
  fixture: string,
): Promise<{ files: string[]; changed: string[]; missing: string[] }> {
  const files = await listPristine(fixture, "test");
  const changed: string[] = [];
  const missing: string[] = [];
  for (const rel of files) {
    const sandboxPath = path.posix.join("test", rel);
    const actual = await ctx.readFile(sandboxPath);
    if (actual === null) {
      missing.push(sandboxPath);
      continue;
    }
    const pristine = await readPristine(fixture, sandboxPath);
    if (pristine !== null && actual !== pristine) changed.push(sandboxPath);
  }
  return { files, changed, missing };
}

/** Renders the tail of a command's output for a failure detail. */
function outputTail(result: CommandResult): string {
  const text = (result.stderr || result.stdout).trim();
  return `${result.timedOut ? "timed out, " : ""}exit ${result.code}: ${text.slice(-500)}`;
}

// ── H1. parser-spec ──────────────────────────────────────────────────────────

/** The hidden suite's describe blocks, with the weight each carries. */
export const EXPR_BLOCKS: Array<{ check: string; block: string; weight: number }> = [
  { check: "precedence", block: "precedence and associativity", weight: 1 },
  { check: "unary-and-nesting", block: "unary minus and nesting", weight: 1 },
  { check: "decimals-and-whitespace", block: "decimals and whitespace", weight: 1 },
  { check: "division-and-modulo", block: "division and modulo", weight: 1 },
  { check: "error-offsets", block: "error offsets", weight: 2 },
];

const parserSpec: BenchTask = {
  id: "parser-spec",
  title: "Write a recursive-descent evaluator with exact error offsets",
  measures: ["coding", "reasoning"],
  fixture: "parser-spec",
  hidden: { "expr.test.ts": "test/expr.test.ts" },
  prompt: [
    "Add an arithmetic expression evaluator to this package.",
    "",
    "Create `src/expr.ts` and export `evaluate(src: string): number`, a recursive-descent",
    "evaluator for this grammar:",
    "",
    '  expr   := term (("+" | "-") term)*',
    '  term   := factor (("*" | "/" | "%") factor)*',
    '  factor := "-" factor | "(" expr ")" | number',
    '  number := digit+ ("." digit+)?',
    "",
    "Rules:",
    "- `*`, `/` and `%` bind tighter than `+` and `-`. Both levels are left-associative.",
    "- Unary minus may be repeated: `--5` is `5`.",
    "- A number is one or more digits, optionally followed by a `.` and one or more digits.",
    "  No leading `+`, no exponent, and no leading `.` — `.5` is not a number.",
    "- Any amount of whitespace may appear between tokens, including before the first and",
    "  after the last.",
    "- Arithmetic is plain IEEE-754 double arithmetic, exactly as JavaScript does it. `/` is",
    "  floating-point division and `%` is JavaScript's remainder, which keeps the sign of the",
    "  left operand. Division and modulo by zero do NOT throw: `1 / 0` is `Infinity`,",
    "  `-1 / 0` is `-Infinity`, and both `0 / 0` and `5 % 0` are `NaN`.",
    "",
    "Malformed input throws a `SyntaxError` whose message ends with the 0-based offset, into",
    "the original string, of the first offending character:",
    "",
    "- `unexpected token at <offset>` when a character turns up where the grammar does not",
    "  allow one;",
    "- `unexpected end of input at <offset>` when the input runs out part-way through an",
    "  expression, where `<offset>` is `src.length`.",
    "",
    "Worked examples:",
    '- `evaluate("2 + 3 * 4")` returns `14`.',
    '- `evaluate("-(2 + 3) * 2 % 7")` returns `-3`.',
    '- `evaluate("1 + * 2")` throws a `SyntaxError` with the message `unexpected token at 4`,',
    "  because the `*` at index 4 sits where a value was expected.",
    '- `evaluate("1 2")` throws a `SyntaxError` with the message `unexpected token at 2`: the',
    "  expression was complete after `1`, so the `2` at index 2 is trailing input.",
    "",
    "Add your own tests under `test/`. Do not add any dependency to `package.json`.",
  ].join("\n"),
  maxTurns: 35,
  timeoutMs: 600_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const source = await ctx.readFile("src/expr.ts");
    const checks: BenchCheck[] = [
      check("file-exists", source !== null, 1, "src/expr.ts was never created"),
    ];
    for (const { check: name, block, weight } of EXPR_BLOCKS) {
      const result = await ctx.run(["bun", "test", "test/expr.test.ts", "-t", block]);
      checks.push(
        check(name, result.code === 0, weight, `hidden block "${block}" — ${outputTail(result)}`),
      );
    }
    return gradeFrom(checks);
  },
};

// ── H2. perf-refactor ────────────────────────────────────────────────────────

/** Printed by the introspection snippet when the exported API is intact. */
const PERF_API = '["findPairs/2","groupAnagrams/1"]';

const PERF_API_SNIPPET = [
  'const m = await import(process.cwd() + "/src/index.ts");',
  "const keys = Object.keys(m).sort();",
  'console.log(JSON.stringify(keys.map((k) => k + "/" + (typeof m[k] === "function" ? m[k].length : "?"))));',
].join("\n");

const perfRefactor: BenchTask = {
  id: "perf-refactor",
  title: "Turn two quadratic helpers linear without changing behaviour",
  measures: ["reasoning", "coding"],
  fixture: "perf-refactor",
  hidden: { "perf.test.ts": "test/perf.test.ts" },
  prompt: [
    "`src/index.ts` exports two functions that are correct but quadratic. Production now calls",
    "both with catalogues two orders of magnitude larger than when they were written, and they",
    "no longer finish. Make them fast.",
    "",
    "Constraints:",
    "- `src/index.ts` must keep exporting exactly `findPairs` and `groupAnagrams`, with the same",
    "  parameter lists. Do not add, remove or rename exports.",
    "- Observable behaviour must not change, ordering included. `findPairs` returns pairs ordered",
    "  by `i` ascending and then `j` ascending; `groupAnagrams` returns groups in order of first",
    "  occurrence, with the words inside each group in input order. Both orderings are part of",
    "  the contract and both are pinned by the existing tests.",
    "- The suite under `test/` passes today. Do not modify, delete, move or add anything under",
    "  `test/` — it must still pass, unchanged, when you are done.",
    "- No dependencies.",
    "",
    "You are being measured on asymptotic complexity, not micro-optimisation: the production",
    "inputs are large enough that only a change of algorithm helps.",
  ].join("\n"),
  maxTurns: 35,
  timeoutMs: 600_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const api = await ctx.run(["bun", "-e", PERF_API_SNIPPET], { timeoutMs: 60_000 });
    const tree = await compareTestTree(ctx, "perf-refactor");
    const visible = await ctx.run(["bun", "test", "test/index.test.ts"], { timeoutMs: 60_000 });
    const correctness = await ctx.run(["bun", "test", "test/perf.test.ts", "-t", "correctness"], {
      timeoutMs: 120_000,
    });
    const scale = await ctx.run(["bun", "test", "test/perf.test.ts", "-t", "scale"], {
      timeoutMs: 60_000,
    });

    const testTreeIntact =
      tree.files.length > 0 && tree.changed.length === 0 && tree.missing.length === 0;

    return gradeFrom([
      check(
        "api-unchanged",
        api.code === 0 && api.stdout.trim() === PERF_API,
        1,
        api.code === 0
          ? `src/index.ts now exports ${api.stdout.trim() || "nothing readable"}, expected ${PERF_API}`
          : `could not import src/index.ts — ${outputTail(api)}`,
      ),
      check(
        "visible-suite-green",
        testTreeIntact && visible.code === 0,
        2,
        testTreeIntact
          ? `test/index.test.ts — ${outputTail(visible)}`
          : `the shipped tests were edited or deleted: ${[...tree.changed, ...tree.missing].join(", ")}`,
      ),
      check(
        "hidden-correctness",
        correctness.code === 0,
        3,
        `hidden correctness block — ${outputTail(correctness)}`,
      ),
      check(
        "scale-budget",
        scale.code === 0,
        3,
        `hidden scale block — ${outputTail(scale)} (still quadratic, or the ordering contract broke)`,
      ),
    ]);
  },
};

// ── H3. multi-bug ────────────────────────────────────────────────────────────

const MULTI_BUG_SUITES = ["range", "rank", "registry", "lookup", "pricing"];

const multiBug: BenchTask = {
  id: "multi-bug",
  title: "Fix five independent bugs under a tight turn budget",
  measures: ["recovery", "multi_file"],
  fixture: "multi-bug",
  prompt: [
    "Every test file in this package is failing. Run `bun test` and make the whole suite green.",
    "",
    "There are five independent bugs, one per test file, all of them in `src/`. They are five",
    "different kinds of mistake, and fixing one will not fix another — work through them one at",
    "a time and re-run only the file you are on to keep the loop short.",
    "",
    "The tests are correct and describe the intended behaviour. Do not modify, delete, move or",
    "add anything under `test/` — fix `src/` only.",
  ].join("\n"),
  maxTurns: 22,
  timeoutMs: 600_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const checks: BenchCheck[] = [];
    for (const suite of MULTI_BUG_SUITES) {
      const file = `test/${suite}.test.ts`;
      const result = await ctx.run(["bun", "test", file], { timeoutMs: 60_000 });
      checks.push(check(`suite-${suite}`, result.code === 0, 1, `${file} — ${outputTail(result)}`));
    }

    const tree = await compareTestTree(ctx, "multi-bug");
    checks.push(
      check(
        "tests-untouched",
        tree.files.length > 0 && tree.changed.length === 0 && tree.missing.length === 0,
        3,
        tree.files.length === 0
          ? "no pristine test files found — fixture is broken"
          : `test files edited or deleted: ${[...tree.changed, ...tree.missing].join(", ")}`,
      ),
    );
    return gradeFrom(checks);
  },
};

// ── H4. deep-search ──────────────────────────────────────────────────────────

/** The verified answer to the `deep-search` task. */
export const DEEP_SEARCH_ANSWER = {
  functionName: "checkoutPolicy",
  file: "src/config/env-source.ts",
  line: 8,
  reads: "process.env.PAYMENT_MODE",
  /** The import chain the answer travels, api surface first. */
  chain: [
    "src/api/index.ts",
    "src/services/index.ts",
    "src/services/billing/policy.ts",
    "src/gateways/select.ts",
    "src/config/payment.ts",
    "src/config/env-source.ts",
  ],
  /** A module that reads PAYMENT_MODE but is unreachable from the api surface. */
  decoyFile: "src/legacy/payment-shim.ts",
} as const;

const DEEP_SEARCH_TARGET = `${DEEP_SEARCH_ANSWER.file}:${DEEP_SEARCH_ANSWER.line}`;

/** The last non-empty line of `text`, stripped of quoting. */
function answerLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines.at(-1) ?? "";
  return last.replaceAll(/^[`'"\s]+/g, "").replaceAll(/[`'"\s.]+$/g, "");
}

const deepSearch: BenchTask = {
  id: "deep-search",
  title: "Trace an env read through a barrel and an alias",
  measures: ["search", "reasoning"],
  fixture: "deep-search",
  prompt: [
    "This repository is a storefront service. `src/api/index.ts` is its public surface.",
    "",
    "Exactly one of the functions exported from `src/api/index.ts` ends up reading",
    "`process.env.PAYMENT_MODE` — not directly, but somewhere down the chain of calls it makes.",
    "Other exports get close without ever reaching that read, and other modules in the tree read",
    "`process.env.PAYMENT_MODE` without being reachable from `src/api/index.ts` at all.",
    "",
    "Find it and report two things: the name of that exported function, and the location of the",
    "line that actually performs the `process.env.PAYMENT_MODE` read, as `<path>:<line>` relative",
    "to the repository root with a 1-based line number.",
    "",
    "Your final message must be exactly `<functionName> <path>:<line>` — one line, two tokens",
    "separated by a single space, nothing else. No prose, no backticks, no code fence.",
  ].join("\n"),
  maxTurns: 30,
  timeoutMs: 480_000,
  grade: async (ctx: GradeContext): Promise<TaskGrade> => {
    const line = answerLine(ctx.finalText);
    const name = (line.split(/\s+/)[0] ?? "").replace(/\(\)$/, "").replaceAll(/[^\w$]/g, "");
    const located = [...line.matchAll(/([\w./-]+\.tsx?):(\d+)/g)].at(-1);
    const location = located ? `${located[1]?.replace(/^\.\//, "")}:${located[2]}` : "";
    const file = located?.[1]?.replace(/^\.\//, "") ?? lastReferencedFile(ctx.finalText);

    return gradeFrom([
      check(
        "function-correct",
        name === DEEP_SEARCH_ANSWER.functionName,
        3,
        `expected the exported function ${DEEP_SEARCH_ANSWER.functionName}, got "${name || "nothing"}"`,
      ),
      check(
        "read-location-correct",
        location === DEEP_SEARCH_TARGET,
        3,
        `expected the read at ${DEEP_SEARCH_TARGET}, got "${location || "no path:line"}"`,
      ),
      check(
        "read-file-correct",
        file === DEEP_SEARCH_ANSWER.file,
        1,
        `expected the read in ${DEEP_SEARCH_ANSWER.file}, got ${file ?? "no file path"}`,
      ),
    ]);
  },
};

// ── registry ─────────────────────────────────────────────────────────────────

export const BENCH_TASKS: BenchTask[] = [
  locate,
  fixFailingTest,
  implementSpec,
  threadField,
  batchRead,
  houseRules,
  parserSpec,
  perfRefactor,
  multiBug,
  deepSearch,
];

/** The original tier — every current frontier model clears all six. */
export const CORE_TASK_IDS: readonly string[] = [
  "locate",
  "fix-failing-test",
  "implement-spec",
  "thread-field",
  "batch-read",
  "house-rules",
];

/** The tier that still separates models. Partial credit is the point here. */
export const HARD_TASK_IDS: readonly string[] = [
  "parser-spec",
  "perf-refactor",
  "multi-bug",
  "deep-search",
];

const TASK_GROUPS: Record<string, readonly string[]> = {
  core: CORE_TASK_IDS,
  hard: HARD_TASK_IDS,
};

/**
 * All tasks, or the named subset. `core` and `hard` expand to their tier.
 * Throws on an id that is neither a task nor a tier.
 */
export function getTasks(ids?: string[]): BenchTask[] {
  if (!ids || ids.length === 0) return BENCH_TASKS;
  const expanded = ids.flatMap((id) => TASK_GROUPS[id] ?? [id]);
  return expanded.map((id) => {
    const task = BENCH_TASKS.find((candidate) => candidate.id === id);
    if (!task) {
      throw new Error(
        `Unknown bench task "${id}". Valid ids: ${BENCH_TASKS.map((t) => t.id).join(", ")}, core, hard`,
      );
    }
    return task;
  });
}
