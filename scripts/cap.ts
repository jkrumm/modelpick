/**
 * `cap` — which model should I launch Claude Code against, and why.
 *
 *   bun run scripts/cap.ts [--json] [--all] [--suite <id>]
 *
 * Answers entirely from stored data: the ccbench runs in `bench_run`, the
 * ArtificialAnalysis index in `metric_snapshot`, the measured rate card in
 * `pick_probe`, and the committed route facts in `src/server/bench/models.ts`.
 * **No API calls, no key, no network, no spend** — that is the whole point of a
 * launcher you run several times a day. `bun run bench` is what costs money.
 *
 * ## The stdout/stderr contract
 *
 * A shell function wraps this to launch Claude Code, so the two streams carry
 * different things and must not be mixed:
 *
 *   - **stdout** — in the default mode, nothing at all until a model is picked,
 *     and then exactly one line: the bare model id, no prefix, no trailing
 *     prose. Under `--json`, the whole summary as JSON and nothing else.
 *   - **stderr** — every human-facing byte: recommendations, table, caveats,
 *     the picklist and its prompt.
 *
 * So the wrapper is just:
 *
 *   cap() { local m; m=$(bun run --cwd ~/SourceRoot/modelpick scripts/cap.ts) \
 *           && [ -n "$m" ] && ca "$m"; }
 *
 * Break that split and the wrapper launches Claude Code against a table header.
 * The picklist only appears when stdin is a TTY; non-interactively stdout stays
 * empty, because guessing a model for an unattended caller is how the wrong id
 * ends up in a script.
 */
import { createInterface } from "node:readline/promises";
import { client } from "../src/db/index.js";
import {
  aaCodingOf,
  aaIntelligenceOf,
  caveatLines,
  formatContext,
  formatDuration,
  formatPct,
  formatRate,
  formatScore,
  formatUsd,
  loadBenchSummary,
  MISSING,
  type BasisLabel,
  type BenchModelRow,
  type BenchPick,
  type BenchSummary,
} from "../src/server/bench/summary.js";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const showAll = args.includes("--all");

function flagValue(name: string): string | null {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] !== undefined) return args[index + 1] as string;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(`--${name}=`.length) : null;
}

const suiteFilter = flagValue("suite");

/** Every human-facing line goes here — see the contract in the header. */
function say(line: string = ""): void {
  process.stderr.write(`${line}\n`);
}

// ── rendering ────────────────────────────────────────────────────────────────

/** Minimum-separator markdown table (dotfiles/rules/formatting.md) — never pad
 *  the separator row, never draw a box. */
function mdTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "-").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/** Column-width labels for the per-row cost basis. */
const BASIS_SHORT: Record<BasisLabel, string> = {
  measured: "meas",
  list: "list",
  unpriced: "—",
  mixed: "mixed",
};

const PICK_LABELS: Record<BenchPick["role"], string> = {
  interactive: "interactive",
  worker: "unattended worker",
  eu: "EU-pinned",
};

function recommendationBlock(summary: BenchSummary): string[] {
  return (["interactive", "worker", "eu"] as const).map((role) => {
    const pick = summary.picks[role];
    const label = PICK_LABELS[role].padEnd(17);
    if (pick === null) return `  ${label} ${MISSING} — no candidate in this suite`;
    return `  ${label} ${pick.modelId.padEnd(20)} — ${pick.why}`;
  });
}

/** `dead` and `incompatible` are why a row is in the table but out of the
 *  picks; the reader has to be able to see which. */
function flagsFor(row: BenchModelRow): string {
  const flags: string[] = [];
  if (row.dead) flags.push("dead");
  if (row.incompatible) flags.push("cc-incompatible");
  if (!row.measured) flags.push("not run");
  else if (row.quality > 0 && row.quality < 1) flags.push("partial");
  return flags.length === 0 ? "" : ` [${flags.join(", ")}]`;
}

/** Suffixed with its basis only when the suite mixes them, so a `measured`
 *  number is never read next to an Anthropic list one without noticing. */
function costCell(row: BenchModelRow, mixedSuite: boolean): string {
  if (!row.measured) return MISSING;
  const cost = formatUsd(row.totalCostUsd);
  if (!mixedSuite || cost === MISSING) return cost;
  return `${cost} ${BASIS_SHORT[row.costBasis]}`;
}

function comparisonTable(
  rows: BenchModelRow[],
  picks: BenchSummary["picks"],
  mixedSuite: boolean,
): string {
  const picked = new Set(
    [picks.interactive, picks.worker, picks.eu].filter((p) => p !== null).map((p) => p.modelId),
  );
  return mdTable(
    [
      "model",
      "AA int",
      "AA code",
      "quality",
      "cost",
      "wall",
      "turns",
      "tool err",
      "$/MTok in",
      "out",
      "context",
      "residency",
    ],
    rows.map((row) => [
      `${picked.has(row.modelId) ? "**" : ""}${row.modelId}${picked.has(row.modelId) ? "**" : ""}${flagsFor(row)}`,
      aaIntelligenceOf(row) === null
        ? MISSING
        : `${(aaIntelligenceOf(row) ?? 0).toFixed(1)}${row.aa?.approximate === true ? "~" : ""}`,
      aaCodingOf(row) === null ? MISSING : (aaCodingOf(row) ?? 0).toFixed(1),
      row.measured ? formatScore(row.quality) : MISSING,
      costCell(row, mixedSuite),
      row.measured ? formatDuration(row.totalDurationMs) : MISSING,
      row.meanTurns === null ? MISSING : row.meanTurns.toFixed(1),
      row.measured ? formatPct(row.toolErrorRate) : MISSING,
      formatRate(row.rate.inPerM),
      formatRate(row.rate.outPerM),
      formatContext(row.rate),
      row.residency,
    ]),
  );
}

// ── picklist ─────────────────────────────────────────────────────────────────

/**
 * Same shape as `scripts/pick.ts`: numbered options, the recommendation marked
 * with `*`, Enter takes it. Returns the chosen id, or null when there is
 * nothing to choose from.
 */
async function picklist(rows: BenchModelRow[], recommended: string | null): Promise<string | null> {
  if (rows.length === 0) return null;

  const defaultIndex = Math.max(
    0,
    rows.findIndex((row) => row.modelId === recommended),
  );

  say();
  say("Launch Claude Code against:");
  rows.forEach((row, i) => {
    const marker = i === defaultIndex ? "*" : " ";
    say(
      `  ${marker} ${i + 1}. ${row.modelId.padEnd(22)} ${formatUsd(row.totalCostUsd).padStart(9)}  ${formatDuration(row.totalDurationMs).padStart(8)}`,
    );
  });

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  let answer: string;
  try {
    answer = await rl.question(
      `\nPick a model [${defaultIndex + 1}: ${rows[defaultIndex]?.modelId ?? ""}] (number, Enter for default): `,
    );
  } finally {
    rl.close();
  }

  const trimmed = answer.trim();
  const chosenIndex = trimmed === "" ? defaultIndex : Number(trimmed) - 1;
  return (rows[chosenIndex] ?? rows[defaultIndex])?.modelId ?? null;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const summary = await loadBenchSummary({ suiteId: suiteFilter });

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    await client.end();
    return;
  }

  if (summary.suiteId === "") {
    say(
      suiteFilter === null
        ? "No ccbench suite has ranked a field yet — run `bun run bench` first."
        : `No suite "${suiteFilter}" in bench_run. Known: ${summary.suites.map((s) => s.suiteId).join(", ") || "none"}.`,
    );
    await client.end();
    return;
  }

  const eligible = summary.models.filter((row) => row.eligible);
  const shown = showAll ? summary.models : eligible;

  say(
    `ccbench suite "${summary.suiteId}" — ${eligible.length} model(s) over ${summary.taskIds.length} task(s), measured ${summary.capturedAt ?? "at an unrecorded time"}.`,
  );
  say();
  say("Recommendation");
  for (const line of recommendationBlock(summary)) say(line);
  say();
  say(comparisonTable(shown, summary.picks, summary.caveats.costBasis === "mixed"));
  say();
  say("Caveats");
  for (const line of caveatLines(summary.caveats)) say(`  - ${line}`);

  if (!process.stdin.isTTY) {
    say();
    say("(non-interactive shell — skipping the picklist; pass --json for scripted use)");
    await client.end();
    return;
  }

  const chosen = await picklist(eligible, summary.picks.interactive?.modelId ?? null);
  await client.end();
  // The one line stdout ever carries in this mode — the shell wrapper reads it.
  if (chosen !== null) process.stdout.write(`${chosen}\n`);
}

await main();
