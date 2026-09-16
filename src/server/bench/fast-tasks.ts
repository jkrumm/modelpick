/**
 * The bench-fast task registry — five narrow, mechanically-graded tasks that a
 * competent fast model should clear. Four are short and TTFT-dominated; the
 * fifth (`longform`) exists to sit above the decode-speed crossover length. This
 * measures cost-of-correctness per effort level, not a difficulty ceiling: see
 * scripts/bench-fast.ts.
 *
 * Every grader is pure (text in, boolean out) and offline — no DB, no fs, no
 * clock — so each one is directly unit-testable against a synthetic response.
 */

export interface FastTask {
  id: string;
  prompt: string;
  maxTokens: number;
  grade(text: string): boolean;
}

// ── shared helpers ───────────────────────────────────────────────────────────

/** Strips a ```json fence (or a bare ``` fence) around a JSON blob, tolerating
 *  surrounding prose the model was told not to add but sometimes adds anyway. */
function stripJsonFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? (fenced[1] ?? text) : text).trim();
}

/** Parses a JSON object out of `text`; null on any failure rather than throwing,
 *  since a malformed response is a grading outcome, not a crash. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stripJsonFence(text)) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ── 1. extract ───────────────────────────────────────────────────────────────

// The first version of this email said the package arrived damaged AND that part
// of the contents was missing, which makes both `damaged_item` and `missing_item`
// correct. Every model that "failed" this task returned `missing_item` — 29
// identical failures across five models and five effort levels, grading a right
// answer as wrong. An ambiguous label is a broken grader, not a hard task: the
// email now describes exactly one issue.
const EXTRACT_EMAIL = [
  "Sehr geehrtes Team,",
  "",
  "mein Name ist Anna Fischer. Ich habe ein Problem mit meiner Bestellung Nr. BE-48213: ",
  "der Karton war an zwei Seiten eingedrückt und das Gerät darin hat einen Riss im ",
  "Gehäuse. Der Lieferumfang war vollständig, aber das Gerät ist in diesem Zustand ",
  "unbrauchbar. Ich benötige es dringend — bitte kümmern Sie sich schnellstmöglich darum.",
  "",
  "Mit freundlichen Grüßen,",
  "Anna Fischer",
].join("\n");

const EXTRACT_EXPECTED = {
  name: "Anna Fischer",
  order_id: "BE-48213",
  issue_category: "damaged_item",
  urgency: "high",
} as const;

const EXTRACT_PROMPT = [
  "Read the following German customer email and extract four fields as a strict JSON",
  "object with exactly these keys: name, order_id, issue_category, urgency.",
  "",
  "issue_category must be exactly one of: damaged_item, missing_item, wrong_item,",
  "delivery_delay, billing_issue, other.",
  "urgency must be exactly one of: low, medium, high.",
  "",
  "Respond with the JSON object only, no other text.",
  "",
  "---",
  EXTRACT_EMAIL,
  "---",
].join("\n");

function gradeExtract(text: string): boolean {
  const parsed = parseJsonObject(text);
  if (parsed === null) return false;
  return (
    parsed["name"] === EXTRACT_EXPECTED.name &&
    parsed["order_id"] === EXTRACT_EXPECTED.order_id &&
    parsed["issue_category"] === EXTRACT_EXPECTED.issue_category &&
    parsed["urgency"] === EXTRACT_EXPECTED.urgency
  );
}

// ── 2. reason ────────────────────────────────────────────────────────────────

const REASON_EXPECTED = 120;

const REASON_PROMPT = [
  "A bakery bakes 240 cookies for the day. It sells 3/8 of them in the morning.",
  "In the afternoon it sells half of what remains after the morning. Then, at the",
  "end of the day, it bakes 45 more cookies.",
  "",
  "How many cookies does the bakery have at the end of the day?",
  "",
  "Show your reasoning briefly, then end your response with the final answer as a",
  "standalone integer on its own last line.",
].join("\n");

/** The final integer appearing anywhere in the response, or null if none. */
function finalInteger(text: string): number | null {
  const matches = [...text.matchAll(/-?\d+/g)];
  const last = matches.at(-1);
  return last ? Number.parseInt(last[0], 10) : null;
}

function gradeReason(text: string): boolean {
  return finalInteger(text) === REASON_EXPECTED;
}

// ── 3. classify ──────────────────────────────────────────────────────────────

const CLASSIFY_LABELS = [
  "billing",
  "technical_support",
  "sales_inquiry",
  "complaint",
  "general_feedback",
] as const;

const CLASSIFY_EXPECTED = "technical_support";

const CLASSIFY_SENTENCE =
  "My internet connection keeps dropping every few minutes and I've already tried " +
  "restarting the router twice.";

const CLASSIFY_PROMPT = [
  `Classify the following sentence into exactly one of these five labels: ${CLASSIFY_LABELS.join(", ")}.`,
  "Respond with the label only, in lowercase, nothing else.",
  "",
  `Sentence: "${CLASSIFY_SENTENCE}"`,
].join("\n");

function gradeClassify(text: string): boolean {
  return text.trim().toLowerCase() === CLASSIFY_EXPECTED;
}

// ── 4. instruct ──────────────────────────────────────────────────────────────

const INSTRUCT_PROMPT = [
  "Write exactly 5 lines about software architecture principles.",
  "Every line must start with exactly '- ' (a dash followed by a single space).",
  "The word 'Modell' must appear exactly twice in total, across all lines combined,",
  "and nowhere else in your response.",
  "Do not include any other text, explanation, blank lines, or a title.",
].join("\n");

function gradeInstruct(text: string): boolean {
  const lines = text
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (lines.length !== 5) return false;
  if (!lines.every((line) => line.startsWith("- "))) return false;
  const occurrences = text.match(/Modell/g)?.length ?? 0;
  return occurrences === 2;
}

// ── 5. longform ──────────────────────────────────────────────────────────────
//
// The other four tasks are all dominated by time-to-first-token — a handful of
// visible tokens means a model that starts late never has room to make it back
// on decode speed. This task exists purely to sit above the crossover length
// where a faster decoder that starts later can still finish first; see the
// "Crossover" section scripts/bench-fast.ts computes from these numbers.

// "Approximately 1200 words" graded against a 900-1600 window punished a model
// for a verbosity the prompt never actually bounded — gemini-3.8-flash wrote
// 1600-2100 words and was scored as failing. The prompt now states an explicit
// range and the grader checks that range, which makes this an instruction-
// following test with a stated contract rather than a guess at what
// "approximately" meant.
const LONGFORM_MIN_WORDS = 1000;
const LONGFORM_MAX_WORDS = 1800;

const LONGFORM_PROMPT = [
  "Write a technical explanation of how TCP congestion control works, aimed at a",
  "mid-level backend engineer who has never studied networking internals.",
  "",
  "Hard requirement: the response must be between 1000 and 1800 words. Stay inside",
  "that range.",
  "",
  "Cover slow start, congestion avoidance, and at least one of fast retransmit/fast",
  "recovery or a modern algorithm such as CUBIC or BBR. Plain prose, no code.",
].join("\n");

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function gradeLongform(text: string): boolean {
  const words = wordCount(text);
  return words >= LONGFORM_MIN_WORDS && words <= LONGFORM_MAX_WORDS;
}

// ── registry ─────────────────────────────────────────────────────────────────

// Budgets are generous on purpose: a thinking model that fills its cap with
// hidden reasoning before producing any visible text is "starved", not wrong
// (see scripts/bench-fast.ts's classifyOutcome / docs/decisions/hermes-brain.md
// for the same trap at a 500-token Gemini cap). 4000 for the four short tasks
// is far more than any of them needs to answer, and 8000 for `longform` still
// leaves headroom above its own ~1600-word ceiling once thinking is included.
export const FAST_TASKS: readonly FastTask[] = [
  { id: "extract", prompt: EXTRACT_PROMPT, maxTokens: 4000, grade: gradeExtract },
  { id: "reason", prompt: REASON_PROMPT, maxTokens: 4000, grade: gradeReason },
  { id: "classify", prompt: CLASSIFY_PROMPT, maxTokens: 4000, grade: gradeClassify },
  { id: "instruct", prompt: INSTRUCT_PROMPT, maxTokens: 4000, grade: gradeInstruct },
  { id: "longform", prompt: LONGFORM_PROMPT, maxTokens: 8000, grade: gradeLongform },
];

/** Selects tasks by id, in registry order; throws on an unknown id so a typo in
 *  `--tasks` fails loudly rather than silently running a smaller field. */
export function getFastTasks(ids?: string[]): FastTask[] {
  if (!ids || ids.length === 0) return [...FAST_TASKS];
  const byId = new Map(FAST_TASKS.map((t) => [t.id, t]));
  return ids.map((id) => {
    const task = byId.get(id);
    if (!task) {
      throw new Error(
        `unknown task id "${id}" — known ids: ${FAST_TASKS.map((t) => t.id).join(", ")}`,
      );
    }
    return task;
  });
}
