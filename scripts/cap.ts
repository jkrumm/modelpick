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

/** Color only when stderr is a terminal and NO_COLOR isn't set — the same
 *  stderr the picklist prompt goes to, so a piped `cap --list` stays clean. */
const useColor = (process.stderr.isTTY ?? false) && !process.env.NO_COLOR;

/**
 * Terminal-native table: aligned columns over a plain dash rule. The markdown
 * renderer this replaced printed `**bold**` and `|-|` separator rows verbatim
 * in the terminal — markdown belongs to the web page (`/bench`), not to a
 * launcher's stderr. `right` columns padStart so the numbers read down; pick
 * rows bold as a whole line (after padding, so ANSI escapes never skew width).
 */
function plainTable(
  cols: { header: string; right?: boolean }[],
  rows: string[][],
  boldRows: Set<number> = new Set(),
): string {
  const widths = cols.map((col, i) =>
    Math.max(col.header.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => {
        const width = widths[i] ?? 0;
        return cols[i]?.right ? cell.padStart(width) : cell.padEnd(width);
      })
      .join("  ")
      .trimEnd();
  const out = [line(cols.map((c) => c.header)), widths.map((w) => "-".repeat(w)).join("  ")];
  rows.forEach((row, i) => {
    const text = line(row);
    out.push(boldRows.has(i) && useColor ? `\x1b[1m${text}\x1b[22m` : text);
  });
  return out.join("\n");
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

function recommendationBlock(summary: BenchSummary): { label: string; text: string }[] {
  return (["interactive", "worker", "eu"] as const).map((role) => {
    const pick = summary.picks[role];
    if (pick === null)
      return { label: PICK_LABELS[role], text: `${MISSING} — no candidate in this suite` };
    return { label: PICK_LABELS[role], text: `${pick.modelId} — ${pick.why}` };
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
  return plainTable(
    [
      { header: "model" },
      { header: "AA int", right: true },
      { header: "AA code", right: true },
      { header: "quality", right: true },
      { header: "cost", right: true },
      { header: "wall", right: true },
      { header: "turns", right: true },
      { header: "tool err", right: true },
      { header: "$/MTok in", right: true },
      { header: "out", right: true },
      { header: "context", right: true },
      { header: "residency" },
    ],
    rows.map((row) => [
      row.modelId + flagsFor(row),
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
    new Set(rows.map((row, i) => (picked.has(row.modelId) ? i : -1)).filter((i) => i >= 0)),
  );
}

// ── picklist ─────────────────────────────────────────────────────────────────

/**
 * Same shape as `scripts/pick.ts`: numbered options, the Enter default marked
 * with `*`, Enter takes it. Returns the chosen id, or null when there is
 * nothing to choose from.
 */
async function picklist(
  rows: BenchModelRow[],
  workerPick: string | null,
  recommended: string | null,
): Promise<string | null> {
  if (rows.length === 0) return null;

  // Enter takes the WORKER pick (glm-class), not the interactive one. The
  // estate's standing default for unattended-ish work is the cheap perfect
  // scorer — agent-dispatch and sideclaw dispatch both run glm-5.3-flash — and
  // a launcher that answers Enter with the premium id bills the IU key on the
  // worst combination: interactive pricing, nobody watching the meter. A human
  // who wants the interactive pick is exactly the person still awake enough to
  // type its number; the default belongs to the model nobody has to defend.
  const defaultId = [workerPick, recommended].find(
    (id) => id !== null && rows.some((row) => row.modelId === id),
  );
  const defaultIndex = Math.max(
    0,
    rows.findIndex((row) => row.modelId === defaultId),
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
  const recs = recommendationBlock(summary);
  const labelWidth = Math.max(...recs.map((r) => r.label.length));
  for (const { label, text } of recs) say(`  ${label.padEnd(labelWidth)}  ${text}`);
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

  const chosen = await picklist(
    eligible,
    summary.picks.worker?.modelId ?? null,
    summary.picks.interactive?.modelId ?? null,
  );
  await client.end();
  // The one line stdout ever carries in this mode — the shell wrapper reads it.
  if (chosen !== null) process.stdout.write(`${chosen}\n`);
}

await main();
