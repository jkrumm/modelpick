/**
 * Pure parts of the review-replay judge (`scripts/bench-review-judge.ts`): building the blinded
 * judge prompt for one corpus item, parsing its verdicts, and aggregating per-arm metrics.
 *
 * The replay (agent-gateway `scripts/replay-review-corpus.ts`) runs the real review pipeline once
 * per arm on the same diff. Pass/fail cannot separate arms there, so a cross-lab judge reads every
 * arm's BLOCKING findings against the frozen diff, pooled and with arm labels hidden, and classifies
 * each one. A judge from a third lab is a hard requirement — it must never share a lab with an arm.
 */

export const VERDICTS = ["confirmed_defect", "not_blocking", "not_a_defect", "unverifiable"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Finding {
  file?: string;
  line?: number;
  message: string;
}

export interface ArmCell {
  arm: string;
  status: string;
  wallMs: number;
  outcome: string | null;
  blocking: Finding[];
  improvements: number;
}

export interface PooledFinding {
  /** Stable id inside one item, e.g. "F3" — the only handle the judge sees. */
  id: string;
  arm: string;
  finding: Finding;
}

/** Deterministic shuffle so the judge never sees the findings grouped by arm. */
export function poolFindings(cells: ArmCell[], seed: string): PooledFinding[] {
  const all = cells.flatMap((c) => c.blocking.map((finding) => ({ arm: c.arm, finding })));
  const keyed = all.map((x, i) => ({ x, k: hash(`${seed}:${i}:${x.finding.message.slice(0, 80)}`) }));
  keyed.sort((a, b) => a.k - b.k);
  return keyed.map(({ x }, i) => ({ id: `F${i + 1}`, arm: x.arm, finding: x.finding }));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const DIFF_CHAR_CAP = 150_000;

export function buildJudgePrompt(input: { diff: string; findings: PooledFinding[] }): string {
  const diff =
    input.diff.length > DIFF_CHAR_CAP
      ? `${input.diff.slice(0, DIFF_CHAR_CAP)}\n[... diff truncated at ${DIFF_CHAR_CAP} chars ...]`
      : input.diff;
  const list = input.findings
    .map((f) => `### ${f.id}\nlocation: ${f.finding.file ?? "?"}:${f.finding.line ?? "?"}\n${f.finding.message}`)
    .join("\n\n");
  return [
    "You are auditing code-review findings that were labelled BLOCKING (must fix before merge).",
    "Several independent reviewers produced them for the same diff; they are pooled and unlabelled.",
    "For EACH finding decide, using only the diff below, one verdict:",
    "- confirmed_defect: a real defect the diff introduces or touches, demonstrable from the changed lines, serious enough to block a merge.",
    "- not_blocking: the point is real but is an improvement, nit, style, edge case or test gap — not merge-blocking.",
    "- not_a_defect: the claim is wrong, already handled in the diff, or contradicts the code.",
    "- unverifiable: deciding needs code outside the diff and the diff gives no evidence either way.",
    "Judge each finding on its own; duplicates of the same defect each get the same verdict.",
    'Answer with JSON only: {"verdicts":[{"id":"F1","verdict":"...","reason":"<= 25 words"}]} covering every id.',
    "",
    "## Diff",
    "```diff",
    diff,
    "```",
    "",
    "## Findings",
    list,
  ].join("\n");
}

export function parseVerdicts(raw: string, ids: string[]): Map<string, Verdict> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("judge returned no JSON object");
  const body = JSON.parse(raw.slice(start, end + 1)) as { verdicts?: { id?: string; verdict?: string }[] };
  const out = new Map<string, Verdict>();
  for (const v of body.verdicts ?? []) {
    if (v.id && ids.includes(v.id) && (VERDICTS as readonly string[]).includes(v.verdict ?? "")) {
      out.set(v.id, v.verdict as Verdict);
    }
  }
  return out;
}

export interface ArmSummary {
  arm: string;
  reviews: number;
  failed: number;
  cleanRate: number;
  blocking: number;
  verdicts: Record<Verdict | "unjudged", number>;
  /** confirmed_defect / blocking — the share of this arm's blocking calls that hold up. */
  blockingPrecision: number | null;
  improvementsPerReview: number;
  p50WallMs: number | null;
  p90WallMs: number | null;
}

export function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] ?? null;
}

export function summarizeArm(
  arm: string,
  cells: ArmCell[],
  verdictByFinding: Map<Finding, Verdict>,
): ArmSummary {
  const mine = cells.filter((c) => c.arm === arm);
  const done = mine.filter((c) => c.status === "done");
  const verdicts: ArmSummary["verdicts"] = {
    confirmed_defect: 0,
    not_blocking: 0,
    not_a_defect: 0,
    unverifiable: 0,
    unjudged: 0,
  };
  let blocking = 0;
  for (const c of done) {
    for (const f of c.blocking) {
      blocking++;
      verdicts[verdictByFinding.get(f) ?? "unjudged"]++;
    }
  }
  const judged = blocking - verdicts.unjudged;
  return {
    arm,
    reviews: done.length,
    failed: mine.length - done.length,
    cleanRate: done.length ? done.filter((c) => c.outcome === "clean").length / done.length : 0,
    blocking,
    verdicts,
    blockingPrecision: judged ? verdicts.confirmed_defect / judged : null,
    improvementsPerReview: done.length ? done.reduce((a, c) => a + c.improvements, 0) / done.length : 0,
    p50WallMs: quantile(done.map((c) => c.wallMs), 0.5),
    p90WallMs: quantile(done.map((c) => c.wallMs), 0.9),
  };
}
