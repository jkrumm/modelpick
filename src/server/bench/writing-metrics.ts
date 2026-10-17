/**
 * bench-writing's pure half — the mechanical lint over a candidate's output,
 * judge-JSON validation, cross-lab eligibility, blind shuffling and the score
 * aggregation. No fetch, no fs, no DB, no clock: text and records in, numbers
 * out, so every rule is unit-testable without a live call. The orchestrator
 * (scripts/bench-writing.ts) drives the HTTP calls and hands results here.
 *
 * The lint counts surface patterns the voice guide bans. It is a smoke
 * detector, not a judge: a hit says "look here", never "this is bad prose".
 */
import { median } from "./fast-metrics.js";
import type { TaskLanguage } from "./writing-tasks.js";

// ── mechanical lint ──────────────────────────────────────────────────────────

/** A sentence longer than this many words is flagged. */
export const LONG_SENTENCE_WORDS = 30;
/** Two sentences repeat each other when their content-word sets overlap by at
 *  least this share of the smaller set. */
export const REPEAT_OVERLAP = 0.6;
/** A sentence needs this many distinct content words before it can be a repeat —
 *  short UI labels and bullet stubs share words by nature. */
export const REPEAT_MIN_CONTENT_WORDS = 5;

export interface LintResult {
  words: number;
  sentences: number;
  /** voice.md "Banned defaults / Lexical" hits — English text only. */
  bannedLexical: { count: number; hits: string[] };
  /** "it's not X, it's Y", "not only … but also", "nicht nur … sondern auch",
   *  "nicht X, sondern Y" — overlapping matches count once. */
  negativeParallelism: number;
  /** German only: -ung/-heit/-keit nouns, and their share per 100 words.
   *  Null for English text. */
  nominalCount: number | null;
  nominalPer100: number | null;
  longSentences: number;
  /** Sentence pairs that restate each other. */
  repeatedPairs: number;
}

const CODE_FENCE = /```[\s\S]*?```/g;

function stripCode(text: string): string {
  return text.replace(CODE_FENCE, " ");
}

/** Whitespace tokens that carry a letter or digit — pipes, dashes and bullet
 *  markers are not words. */
export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token));
}

const ABBREVIATIONS = /\b(?:e\.g|i\.e|z\.\s?B|d\.\s?h|u\.\s?a|bzw|ca|vs|etc|nr|approx)\./gi;
const DOT_PLACEHOLDER = "\u0001";

/** Sentences of prose: one line is never merged into the next (a bullet is its
 *  own sentence), table rows are skipped, and abbreviation dots do not split. */
export function sentencesOf(text: string): string[] {
  const protectedText = stripCode(text).replace(ABBREVIATIONS, (m) => m.replaceAll(".", DOT_PLACEHOLDER));
  const sentences: string[] = [];
  for (const rawLine of protectedText.split("\n")) {
    if (/^\s*\|/.test(rawLine)) continue;
    const line = rawLine.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "").replaceAll("*", "").trim();
    if (line === "") continue;
    for (const part of line.split(/(?<=[.!?…])["'”’)\]]*\s+/)) {
      const sentence = part.replaceAll(DOT_PLACEHOLDER, ".").trim();
      if (wordsOf(sentence).length > 0) sentences.push(sentence);
    }
  }
  return sentences;
}

// banned lexical (voice.md) — inflections included, English only

const BANNED_LEXICAL =
  /\b(?:delv(?:e|es|ed|ing)|tapestr(?:y|ies)|testament|leverag(?:e|es|ed|ing)|unlock(?:s|ed|ing)?|crucial(?:ly)?|robust(?:ness)?|seamless(?:ly)?|ever-evolving|transformative|landscapes?|realms?|myriad|foster(?:s|ed|ing)?|pivotal|vibrant|meticulous(?:ly)?|holistic(?:ally)?|game-changers?)\b/gi;

function bannedLexicalIn(text: string): { count: number; hits: string[] } {
  const hits = [...text.matchAll(BANNED_LEXICAL)].map((m) => m[0].toLowerCase());
  return { count: hits.length, hits };
}

// negative parallelism

const NEG_SUBJECT = String.raw`(?:it|this|that|they|these|those|there)(?:['’](?:s|re)|\s+(?:is|are|was|were))\s+not`;
const NEG_CONTRACTED = String.raw`(?:isn['’]t|aren['’]t|wasn['’]t|weren['’]t)`;
const NEG_COPULA = String.raw`(?:is|are|was|were)\s+not`;
const MODIFIER = String.raw`(?:just|only|merely|simply)`;
const GAP = String.raw`[^.!?\n]{1,80}?`;
const SEPARATOR = String.raw`(?:\s*[,;:—–]\s*|\s+-\s+|\.\s+)`;
const POSITIVE_SUBJECT = String.raw`(?:it|this|that|they|these|those)(?:['’](?:s|re)|\s+(?:is|are|was|were))`;

const NEGATIVE_PARALLELISM: Record<TaskLanguage, RegExp[]> = {
  en: [
    // "It's not X, it's Y" / "It's not X. It's Y." / "X isn't Y; it's Z"
    new RegExp(
      String.raw`\b(?:${NEG_SUBJECT}|${NEG_CONTRACTED})\s+(?:${MODIFIER}\s+)?${GAP}${SEPARATOR}${POSITIVE_SUBJECT}\b`,
      "gi",
    ),
    // "is not just X, but Y"
    new RegExp(
      String.raw`\b(?:${NEG_SUBJECT}|${NEG_CONTRACTED}|${NEG_COPULA})\s+${MODIFIER}\s+${GAP}${SEPARATOR}(?:but|rather|instead)\b`,
      "gi",
    ),
    // "not only X but (also) Y"
    /\bnot\s+only\b[^.!?\n]{1,120}?\bbut(?:\s+also)?\b/gi,
  ],
  de: [
    // "nicht nur X, sondern (auch) Y"
    /\bnicht\s+nur\b[^.!?\n]{1,120}?\bsondern(?:\s+auch)?\b/gi,
    // "nicht X, sondern Y" / "kein X, sondern Y"
    /\b(?:nicht|kein(?:e|en|em|er|es)?)\s+(?!nur\b)[^.!?\n,;—–]{1,60}?\s*[,;—–]\s*sondern\b/gi,
  ],
};

function countNegativeParallelism(text: string, language: TaskLanguage): number {
  const ranges: Array<[number, number]> = [];
  for (const pattern of NEGATIVE_PARALLELISM[language]) {
    for (const m of text.matchAll(pattern)) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let count = 0;
  let end = -1;
  for (const [from, to] of ranges) {
    if (from >= end) count++;
    end = Math.max(end, to);
  }
  return count;
}

// German Nominalstil

const NOMINAL_NOUN = /^[A-ZÄÖÜ][a-zäöüß]{2,}(?:ung|heit|keit)(?:en|s|es|e)?$/;

/** Counts -ung/-heit/-keit nouns. Only those German suffixes are looked at, so
 *  English tech terms in German text (Deployment, Pipeline, Cache) never count. */
function nominalCountIn(text: string): number {
  const tokens = text.match(/\p{L}+/gu) ?? [];
  return tokens.filter((token) => NOMINAL_NOUN.test(token)).length;
}

// repeated content

const STOPWORDS = new Set([
  "that", "this", "with", "from", "have", "been", "were", "they", "their", "there", "which", "would", "could",
  "should", "about", "into", "than", "then", "also", "only", "just", "when", "what", "will", "your", "does",
  "und", "oder", "aber", "dass", "nicht", "eine", "einen", "einer", "einem", "eines", "dieser", "diese", "dieses",
  "auch", "wird", "werden", "wurde", "sind", "sein", "habe", "haben", "kann", "noch", "oder", "wenn", "mehr",
  "für", "mit", "von", "dem", "den", "der", "die", "das", "ist", "ein", "als", "bei", "nach", "über", "aus",
]);

function contentWords(sentence: string): Set<string> {
  const tokens = sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens.filter((t) => t.length >= 4 && !STOPWORDS.has(t)));
}

function countRepeatedPairs(sentences: string[]): number {
  const sets = sentences.map(contentWords).filter((s) => s.size >= REPEAT_MIN_CONTENT_WORDS);
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i] as Set<string>;
      const b = sets[j] as Set<string>;
      let shared = 0;
      for (const word of a) if (b.has(word)) shared++;
      if (shared / Math.min(a.size, b.size) >= REPEAT_OVERLAP) pairs++;
    }
  }
  return pairs;
}

export function lintText(text: string, language: TaskLanguage): LintResult {
  const prose = stripCode(text);
  const words = wordsOf(prose).length;
  const sentences = sentencesOf(text);
  const nominalCount = language === "de" ? nominalCountIn(prose) : null;
  return {
    words,
    sentences: sentences.length,
    bannedLexical: language === "en" ? bannedLexicalIn(prose) : { count: 0, hits: [] },
    negativeParallelism: countNegativeParallelism(prose, language),
    nominalCount,
    nominalPer100: nominalCount === null || words === 0 ? null : Math.round((nominalCount / words) * 1000) / 10,
    longSentences: sentences.filter((s) => wordsOf(s).length > LONG_SENTENCE_WORDS).length,
    repeatedPairs: countRepeatedPairs(sentences),
  };
}

// ── labs and cross-lab judging ───────────────────────────────────────────────

export type Lab = "anthropic" | "google" | "openai" | "other";

export function labOf(modelId: string): Lab {
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("gpt-")) return "openai";
  return "other";
}

/** A judge never scores output from its own lab. Unknown labs are never
 *  treated as "the same lab" — they only exclude the identical model id. */
export function isEligibleJudge(judge: string, candidate: string): boolean {
  if (judge === candidate) return false;
  const lab = labOf(judge);
  return lab === "other" || lab !== labOf(candidate);
}

// ── blind shuffling ──────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic Fisher-Yates: the same seed always yields the same order. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(hashSeed(seed));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** "A", "B", … in a shuffled order — label → model. */
export function blindAssign(models: readonly string[], seed: string): Array<{ label: string; model: string }> {
  return seededShuffle(models, seed).map((model, index) => ({ label: String.fromCharCode(65 + index), model }));
}

// ── judge JSON ───────────────────────────────────────────────────────────────

export interface CriterionVerdict {
  score: number;
  reason: string;
}
/** label → criterion id → verdict */
export type JudgeScores = Record<string, Record<string, CriterionVerdict>>;

export type JudgeParse = { ok: true; scores: JudgeScores } | { ok: false; error: string };

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? (fenced[1] ?? text) : text).trim();
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  return first >= 0 && last > first ? body.slice(first, last + 1) : body;
}

/**
 * Strict validation of a judge reply: `{"scores": {"<label>": {"<criterion>":
 * {"score": 1-5, "reason": "…"}}}}`. Every expected label and criterion must be
 * present with an integer score in 1..5 and a string reason. Unknown extra
 * labels are ignored; anything else is an error naming the first problem so a
 * retry (or the raw record) shows what went wrong.
 */
export function parseJudgeJson(text: string, labels: readonly string[], criteria: readonly string[]): JudgeParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, error: "reply is not valid JSON" };
  }
  const root = (parsed as { scores?: unknown } | null)?.scores;
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return { ok: false, error: 'missing top-level "scores" object' };
  }
  const scores: JudgeScores = {};
  for (const label of labels) {
    const entry = (root as Record<string, unknown>)[label];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `no scores for label ${label}` };
    }
    const perCriterion: Record<string, CriterionVerdict> = {};
    for (const criterion of criteria) {
      const cell = (entry as Record<string, unknown>)[criterion] as { score?: unknown; reason?: unknown } | undefined;
      if (cell === undefined || cell === null || typeof cell !== "object") {
        return { ok: false, error: `${label}: missing criterion ${criterion}` };
      }
      const { score, reason } = cell;
      if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) {
        return { ok: false, error: `${label}.${criterion}: score must be an integer 1-5` };
      }
      if (typeof reason !== "string") {
        return { ok: false, error: `${label}.${criterion}: reason must be a string` };
      }
      perCriterion[criterion] = { score, reason: reason.trim() };
    }
    scores[label] = perCriterion;
  }
  return { ok: true, scores };
}

// ── aggregation ──────────────────────────────────────────────────────────────

/** One eligible judge's scores for one candidate output, criterion → 1-5. */
export interface JudgeVerdict {
  judge: string;
  scores: Record<string, number>;
}

export interface CellScore {
  /** Median across eligible judges, per criterion. */
  perCriterion: Record<string, number>;
  /** Mean of the per-criterion medians; null when no judge scored the cell. */
  overall: number | null;
  /** How many judges scored this cell — a cell judged by one is visible. */
  judgeCount: number;
  judges: string[];
}

export function aggregateCell(verdicts: readonly JudgeVerdict[], criteria: readonly string[]): CellScore {
  const perCriterion: Record<string, number> = {};
  for (const criterion of criteria) {
    const values = verdicts.map((v) => v.scores[criterion]).filter((s): s is number => s !== undefined);
    const mid = median(values);
    if (mid !== null) perCriterion[criterion] = mid;
  }
  const medians = Object.values(perCriterion);
  return {
    perCriterion,
    overall: medians.length === 0 ? null : medians.reduce((sum, v) => sum + v, 0) / medians.length,
    judgeCount: verdicts.length,
    judges: verdicts.map((v) => v.judge),
  };
}

export interface LeaderboardRow {
  model: string;
  /** Mean of per-task overalls over the tasks that were scored. */
  overall: number | null;
  tasksScored: number;
  /** Smallest judge count across the scored tasks. */
  minJudges: number | null;
}

export function leaderboard(
  cells: ReadonlyArray<{ model: string; overall: number | null; judgeCount: number }>,
): LeaderboardRow[] {
  const byModel = new Map<string, Array<{ overall: number; judgeCount: number }>>();
  for (const cell of cells) {
    const list = byModel.get(cell.model) ?? [];
    if (cell.overall !== null) list.push({ overall: cell.overall, judgeCount: cell.judgeCount });
    byModel.set(cell.model, list);
  }
  const rows = [...byModel].map(([model, scored]): LeaderboardRow => ({
    model,
    overall: scored.length === 0 ? null : scored.reduce((sum, c) => sum + c.overall, 0) / scored.length,
    tasksScored: scored.length,
    minJudges: scored.length === 0 ? null : Math.min(...scored.map((c) => c.judgeCount)),
  }));
  return rows.toSorted((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
}

// ── generation outcome ───────────────────────────────────────────────────────

export type GenerationStatus = "ok" | "starved" | "error";

/** Same rule as bench-fast's classifyOutcome: a call that hit its cap with
 *  nothing visible spent the whole budget thinking — a budget failure, never a
 *  bad answer. Empty text with any other finish reason is an error. */
export function classifyGeneration(finishReason: string | null, text: string): GenerationStatus {
  if (text.trim() !== "") return "ok";
  return finishReason === "length" ? "starved" : "error";
}

// ── run records ──────────────────────────────────────────────────────────────

export interface GenerationRecord {
  task: string;
  model: string;
  status: GenerationStatus;
  text: string;
  finishReason: string | null;
  wallMs: number;
  promptTokens: number;
  visibleTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  error: string | null;
  lint: LintResult | null;
}

export interface JudgeRecord {
  task: string;
  judge: string;
  /** The neutral label shown to this judge → the candidate model behind it. */
  labels: Record<string, string>;
  ok: boolean;
  /** Calls made: 1, or 2 when the first reply was malformed. */
  attempts: number;
  error: string | null;
  /** The last raw reply, kept whether or not it parsed. */
  raw: string;
  scores: JudgeScores | null;
  wallMs: number;
  costUsd: number | null;
}

export interface ScoredCell extends CellScore {
  task: string;
  model: string;
}

/** Folds every successful judge record into one cell per (task, candidate). A
 *  judge that failed, or never saw a candidate (own lab), contributes nothing. */
export function scoreCells(
  judgeRecords: readonly JudgeRecord[],
  cells: ReadonlyArray<{ task: string; model: string }>,
  criteria: readonly string[],
): ScoredCell[] {
  return cells.map(({ task, model }) => {
    const verdicts: JudgeVerdict[] = [];
    for (const record of judgeRecords) {
      if (record.task !== task || !record.ok || !record.scores) continue;
      const label = Object.entries(record.labels).find(([, m]) => m === model)?.[0];
      const perCriterion = label === undefined ? undefined : record.scores[label];
      if (!perCriterion) continue;
      verdicts.push({
        judge: record.judge,
        scores: Object.fromEntries(Object.entries(perCriterion).map(([id, v]) => [id, v.score])),
      });
    }
    return { task, model, ...aggregateCell(verdicts, criteria) };
  });
}
