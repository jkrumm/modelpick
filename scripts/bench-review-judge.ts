/**
 * bench-review-judge — score an agent-gateway review replay with a cross-lab judge.
 *
 *   bun run bench:review-judge --replay <dir> [--corpus <jsonl>] [--judge gpt-6.1-sol]
 *                              [--concurrency 3] [--dry-run]
 *
 * Input is the output dir of agent-gateway `scripts/replay-review-corpus.ts` (one cell JSON per
 * corpus item × arm) plus the frozen corpus (the diffs). For every item, all arms' BLOCKING
 * findings are pooled, shuffled and unlabelled, and one judge call classifies each against the
 * frozen diff (src/server/bench/review-judge.ts). Per arm it reports confirmed-blocking hits, false
 * blocking, clean rate, p50/p90 wall time, and angle + synthesis session cost from usage-tracker's
 * agent-gateway sessions sink (attributed by project, model and the job's time window — the sink
 * carries no job id, so an overlapping live review on the same project and model would be counted
 * too).
 *
 * Spends real money on the judge (~$0.05-0.15 per item at gpt-6.1-sol rates). The corpus holds
 * work diffs: everything is written next to the replay, never into this repo.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildJudgePrompt,
  parseVerdicts,
  poolFindings,
  summarizeArm,
  type ArmCell,
  type Finding,
  type Verdict,
} from "../src/server/bench/review-judge.js";

interface CellFile {
  itemJobId: string;
  arm: string;
  model: string | null;
  submittedAt: string;
  status: string;
  wallMs: number;
  job?: { result?: { outcome?: string; blocking?: Finding[]; improvements?: unknown[] } | null } | null;
}

interface CorpusItem {
  jobId: string;
  repo: string;
  diff: string;
}

const BASELINE_MODEL = "claude-haiku-5-5-eu";
// USD per MTok (in/out) for the judge when IU reports no usage.cost (the Azure-routed GPT ids do
// not). Requesty list, 2026-10-19.
const JUDGE_RATES: Record<string, { in: number; out: number }> = {
  "gpt-6.1-sol": { in: 2, out: 10 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75 },
  "gpt-6-luna": { in: 0.1, out: 0.5 },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set — run via bun run bench:review-judge`);
  return v;
}

async function judge(model: string, prompt: string): Promise<{ text: string; costUsd: number | null }> {
  const resp = await fetch(`${env("IU_OPENAI_BASE_URL")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("IU_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: "high",
      max_completion_tokens: 32_000,
    }),
    signal: AbortSignal.timeout(30 * 60_000),
  });
  if (!resp.ok) throw new Error(`judge HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const body = (await resp.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error(`judge returned empty content (finish_reason ${body.choices?.[0]?.finish_reason})`);
  if (typeof body.usage?.cost === "number") return { text, costUsd: body.usage.cost };
  const rate = JUDGE_RATES[model];
  const estimate = rate
    ? ((body.usage?.prompt_tokens ?? 0) * rate.in + (body.usage?.completion_tokens ?? 0) * rate.out) / 1e6
    : null;
  return { text, costUsd: estimate };
}

interface SessionRow {
  tool?: string;
  project?: string;
  model?: string;
  tsStart?: string;
  costUsd?: number;
}

function loadSessions(): SessionRow[] {
  const path = join(homedir(), ".local/share/usage-tracker/agent-gateway-sessions.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as SessionRow];
      } catch {
        return [];
      }
    });
}

function cellCost(cell: CellFile, repo: string, sessions: SessionRow[]): number {
  const model = cell.model ?? BASELINE_MODEL;
  const from = Date.parse(cell.submittedAt);
  const to = from + cell.wallMs;
  return sessions
    .filter(
      (s) =>
        (s.tool === "review:angle" || s.tool === "review:synthesis") &&
        s.project === repo &&
        s.model === model &&
        s.tsStart !== undefined &&
        Date.parse(s.tsStart) >= from &&
        Date.parse(s.tsStart) <= to,
    )
    .reduce((a, s) => a + (s.costUsd ?? 0), 0);
}

async function runPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++] as T);
    }),
  );
}

async function main(): Promise<void> {
  const replay = arg("replay");
  if (!replay) throw new Error("--replay <dir> is required");
  const corpusPath =
    arg("corpus") ?? join(homedir(), ".local/share/agent-gateway/bench/review-corpus-2026-10-19/corpus.jsonl");
  const judgeModel = arg("judge") ?? "gpt-6.1-sol";
  const concurrency = Number(arg("concurrency") ?? "3");
  const dryRun = process.argv.includes("--dry-run");

  const corpus = new Map(
    readFileSync(corpusPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as CorpusItem)
      .map((c) => [c.jobId, c]),
  );
  const cellDir = join(replay, "cells");
  const files = readdirSync(cellDir).filter((f) => f.endsWith(".json"));
  const raw = files.map((f) => JSON.parse(readFileSync(join(cellDir, f), "utf8")) as CellFile);

  const toCell = (c: CellFile): ArmCell => ({
    arm: c.arm,
    status: c.status,
    wallMs: c.wallMs,
    outcome: c.job?.result?.outcome ?? null,
    blocking: c.job?.result?.blocking ?? [],
    improvements: c.job?.result?.improvements?.length ?? 0,
  });
  const byItem = new Map<string, { file: CellFile; cell: ArmCell }[]>();
  for (const file of raw) {
    const list = byItem.get(file.itemJobId) ?? [];
    list.push({ file, cell: toCell(file) });
    byItem.set(file.itemJobId, list);
  }

  const arms = [...new Set(raw.map((c) => c.arm))].sort();
  // Only items every arm finished are comparable.
  const items = [...byItem.entries()].filter(
    ([id, cells]) => corpus.has(id) && arms.every((a) => cells.some((c) => c.cell.arm === a && c.cell.status === "done")),
  );
  const toJudge = items.filter(([, cells]) => cells.some((c) => c.cell.blocking.length > 0));
  console.error(
    `${items.length} comparable items (${arms.join(", ")}), ${toJudge.length} with blocking findings to judge on ${judgeModel}`,
  );
  if (dryRun) {
    console.error("dry run — nothing called, nothing spent");
    return;
  }

  const verdictByFinding = new Map<Finding, Verdict>();
  const judgeLog: unknown[] = [];
  let judgeCost = 0;
  await runPool(toJudge, concurrency, async ([id, cells]) => {
    const pooled = poolFindings(
      cells.map((c) => c.cell),
      id,
    );
    const prompt = buildJudgePrompt({ diff: corpus.get(id)?.diff ?? "", findings: pooled });
    try {
      const { text, costUsd } = await judge(judgeModel, prompt);
      judgeCost += costUsd ?? 0;
      const verdicts = parseVerdicts(
        text,
        pooled.map((p) => p.id),
      );
      for (const p of pooled) {
        const v = verdicts.get(p.id);
        if (v) verdictByFinding.set(p.finding, v);
      }
      judgeLog.push({ item: id, pooled: pooled.map((p) => ({ id: p.id, arm: p.arm })), raw: text });
      console.error(`judged ${id}: ${verdicts.size}/${pooled.length}`);
    } catch (err) {
      judgeLog.push({ item: id, error: String(err) });
      console.error(`judge failed on ${id}: ${String(err)}`);
    }
  });

  const comparable = items.flatMap(([, cells]) => cells.map((c) => c.cell));
  const sessions = loadSessions();
  const rows = arms.map((arm) => {
    const s = summarizeArm(arm, comparable, verdictByFinding);
    const cost = items
      .flatMap(([id, cells]) => cells.filter((c) => c.cell.arm === arm).map((c) => cellCost(c.file, corpus.get(id)?.repo ?? "", sessions)))
      .reduce((a, b) => a + b, 0);
    return { ...s, costUsd: cost, costPerReview: s.reviews ? cost / s.reviews : null };
  });

  const pct = (x: number | null): string => (x === null ? "—" : `${(x * 100).toFixed(0)}%`);
  const min = (ms: number | null): string => (ms === null ? "—" : `${(ms / 60_000).toFixed(1)} min`);
  const md = [
    `# Review replay — judged by ${judgeModel}`,
    "",
    `${items.length} items where every arm finished; ${toJudge.length} had blocking findings. Judge cost $${judgeCost.toFixed(2)} (IU usage.cost, else estimated from tokens at list rate).`,
    "",
    "| arm | reviews | clean | blocking | confirmed | not blocking | not a defect | unverifiable | precision | improvements/review | p50 | p90 | cost (angle+synthesis) | per review |",
    "|-|-|-|-|-|-|-|-|-|-|-|-|-|-|",
    ...rows.map(
      (r) =>
        `| ${r.arm} | ${r.reviews} | ${pct(r.cleanRate)} | ${r.blocking} | ${r.verdicts.confirmed_defect} | ${r.verdicts.not_blocking} | ${r.verdicts.not_a_defect} | ${r.verdicts.unverifiable} | ${pct(r.blockingPrecision)} | ${r.improvementsPerReview.toFixed(1)} | ${min(r.p50WallMs)} | ${min(r.p90WallMs)} | $${r.costUsd.toFixed(2)} | ${r.costPerReview === null ? "—" : `$${r.costPerReview.toFixed(3)}`} |`,
    ),
    "",
    "precision = confirmed / judged blocking. False blocking = not blocking + not a defect.",
    "Cost: usage-tracker sessions sink, review:angle + review:synthesis rows matched by project, model and job window (no job id in the sink).",
    "PR items were replayed against the PR's current head; the judge reads the frozen corpus diff, so a PR that moved can make a correct finding look unverifiable.",
  ].join("\n");
  writeFileSync(join(replay, "judged.md"), `${md}\n`);
  writeFileSync(join(replay, "judged.json"), JSON.stringify({ judgeModel, judgeCost, rows, judgeLog }, null, 2));
  console.log(md);
}

await main();
