import { z } from "zod";
import { decisionSpec, type DecisionWire } from "../../db/decision-models.js";

/**
 * Typed client for IU's two decision wires, behind one neutral shape.
 *
 *  - `questions`: `POST {IU_OPENAI_BASE_URL}/chat/completions` with
 *    `response_format: { type: "questions", questions }` and header `api-key`.
 *    The answers come back as a JSON STRING in `choices[0].message.content`.
 *    Clef, Clef Flash, PPLX Decider, Jev.
 *  - `decisions`: `POST {IU_OPENAI_BASE_URL}/decisions` (OpenAI's Decisions API),
 *    answers in a top-level `answers` array matched by `name`. GPT-6 Luna.
 *
 * Neither wire takes sampling parameters. Envelopes verified live 2026-10-09 —
 * docs/decisions/model-configs.md.
 *
 * Request building and response parsing are pure so they are testable against
 * the recorded envelopes; `callDecision` is the only function that does I/O.
 */

// ── neutral question / answer shapes ─────────────────────────────────────────

export type DecisionQuestion =
  | {
      /** Yes/no. `noul` on the questions wire, `predicate` on the decisions wire. */
      type: "boolean";
      instructions: string;
      criteria?: { true: string; false: string };
    }
  | {
      type: "choice";
      instructions: string;
      /** option value -> description */
      criteria: Record<string, string>;
    }
  | {
      type: "score";
      instructions: string;
      /** Low to high; the answer is a fractional index into this list. */
      levels: Array<{ label: string; description: string }>;
    };

export type DecisionAnswer =
  | { type: "boolean"; probability: number }
  | {
      type: "choice";
      choice: string;
      confidence: number | null;
      probabilities: Record<string, number>;
    }
  | {
      type: "score";
      /** Fractional index into the question's levels (0 = lowest). */
      score: number;
      confidence: number | null;
      probabilities: Record<string, number> | null;
    }
  | { type: "refusal"; message: string | null };

export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported USD; null when the wire reports none (the decisions wire). */
  costUsd: number | null;
}

export interface DecisionResult {
  answers: Record<string, DecisionAnswer>;
  usage: DecisionUsage;
  /** Model the gateway says answered, e.g. "Cloudflare/clef"; null when absent. */
  servedModel: string | null;
}

export type DecisionState = string | Record<string, unknown>;

export class DecisionError extends Error {
  constructor(
    /** HTTP status; 0 for a transport failure, a malformed envelope or a missing answer. */
    public readonly status: number,
    message: string,
    public readonly body: string = "",
  ) {
    super(message);
    this.name = "DecisionError";
  }
}

// ── routing ──────────────────────────────────────────────────────────────────

export interface DecisionRoute {
  wire: DecisionWire;
  /** The model name to put on the wire. */
  apiModel: string;
}

/** Unknown ids default to the questions wire — the generic decision shape. */
export function routeFor(modelId: string): DecisionRoute {
  const spec = decisionSpec(modelId);
  return { wire: spec?.wire ?? "questions", apiModel: spec?.apiModel ?? modelId };
}

// ── request building ─────────────────────────────────────────────────────────

export interface DecisionRequest {
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

function stateText(state: DecisionState): string {
  return typeof state === "string" ? state : JSON.stringify(state);
}

function toQuestionsWire(question: DecisionQuestion): unknown {
  if (question.type === "boolean") {
    return {
      type: "noul",
      instructions: question.instructions,
      ...(question.criteria && { criteria: question.criteria }),
    };
  }
  if (question.type === "choice") {
    return { type: "choice", instructions: question.instructions, criteria: question.criteria };
  }
  return {
    type: "score",
    instructions: question.instructions,
    criteria: question.levels.map((l) => `${l.label}: ${l.description}`),
  };
}

function toDecisionsWire(name: string, question: DecisionQuestion): unknown {
  if (question.type === "boolean") {
    return { type: "predicate", name, instructions: question.instructions };
  }
  if (question.type === "choice") {
    return {
      type: "choice",
      name,
      instructions: question.instructions,
      choices: Object.entries(question.criteria).map(([value, description]) => ({
        value,
        description,
      })),
    };
  }
  return {
    type: "score",
    name,
    instructions: question.instructions,
    levels: question.levels,
  };
}

export function buildDecisionRequest(input: {
  modelId: string;
  state: DecisionState;
  questions: Record<string, DecisionQuestion>;
  apiKey: string;
}): DecisionRequest {
  const { modelId, state, questions, apiKey } = input;
  const route = routeFor(modelId);
  if (route.wire === "decisions") {
    return {
      path: "/decisions",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: {
        model: route.apiModel,
        input: stateText(state),
        questions: Object.entries(questions).map(([name, q]) => toDecisionsWire(name, q)),
      },
    };
  }
  return {
    path: "/chat/completions",
    headers: { "content-type": "application/json", "api-key": apiKey },
    body: {
      model: route.apiModel,
      stream: false,
      messages: [{ role: "user", content: stateText(state) }],
      response_format: {
        type: "questions",
        questions: Object.fromEntries(
          Object.entries(questions).map(([name, q]) => [name, toQuestionsWire(q)]),
        ),
      },
    },
  };
}

// ── response parsing ─────────────────────────────────────────────────────────

const probability = z.number().finite().min(0).max(1);

const questionsAnswer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probability.optional(),
    probabilities: z.record(z.string(), probability).optional(),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number().finite().min(0),
    confidence: probability.optional(),
    probabilities: z.record(z.string(), probability).optional(),
  }),
]);

const questionsEnvelope = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function malformed(what: string, body: string): DecisionError {
  return new DecisionError(0, `decision response is malformed: ${what}`, body);
}

export function parseQuestionsResponse(bodyText: string): DecisionResult {
  const envelope = questionsEnvelope.safeParse(parseJson(bodyText));
  if (!envelope.success) throw malformed(envelope.error.message, bodyText);
  const content = envelope.data.choices[0]?.message.content ?? "";
  const answers = z.record(z.string(), questionsAnswer).safeParse(parseJson(content));
  if (!answers.success) throw malformed(answers.error.message, content);

  const out: Record<string, DecisionAnswer> = {};
  for (const [name, a] of Object.entries(answers.data)) {
    if (a.type === "noul") out[name] = { type: "boolean", probability: a.noul };
    else if (a.type === "choice") {
      out[name] = {
        type: "choice",
        choice: a.choice,
        confidence: a.confidence ?? a.probabilities?.[a.choice] ?? null,
        probabilities: a.probabilities ?? {},
      };
    } else {
      out[name] = {
        type: "score",
        score: a.score,
        confidence: a.confidence ?? null,
        probabilities: a.probabilities ?? null,
      };
    }
  }
  const usage = envelope.data.usage;
  return {
    answers: out,
    usage: {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      costUsd: usage?.cost ?? null,
    },
    servedModel: envelope.data.model ?? null,
  };
}

const decisionsAnswer = z.discriminatedUnion("type", [
  z.object({ name: z.string(), type: z.literal("predicate"), probability }),
  z.object({
    name: z.string(),
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probability.optional(),
    probabilities: z.array(z.object({ value: z.string(), probability })).optional(),
  }),
  z.object({
    name: z.string(),
    type: z.literal("score"),
    score: z.number().finite().min(0),
    confidence: probability.optional(),
    probabilities: z
      .array(z.object({ value: z.union([z.string(), z.number()]), probability }))
      .optional(),
  }),
  z
    .object({
      name: z.string(),
      type: z.literal("refusal"),
      refusal: z.string().optional(),
      message: z.string().optional(),
    })
    .passthrough(),
]);

const decisionsEnvelope = z.object({
  model: z.string().optional(),
  answers: z.array(decisionsAnswer),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

export function parseDecisionsResponse(bodyText: string): DecisionResult {
  const envelope = decisionsEnvelope.safeParse(parseJson(bodyText));
  if (!envelope.success) throw malformed(envelope.error.message, bodyText);

  const out: Record<string, DecisionAnswer> = {};
  for (const a of envelope.data.answers) {
    if (a.type === "predicate") out[a.name] = { type: "boolean", probability: a.probability };
    else if (a.type === "choice") {
      const probabilities = Object.fromEntries(
        (a.probabilities ?? []).map((p) => [p.value, p.probability]),
      );
      out[a.name] = {
        type: "choice",
        choice: a.choice,
        confidence: a.confidence ?? probabilities[a.choice] ?? null,
        probabilities,
      };
    } else if (a.type === "score") {
      out[a.name] = {
        type: "score",
        score: a.score,
        confidence: a.confidence ?? null,
        probabilities: a.probabilities
          ? Object.fromEntries(a.probabilities.map((p) => [String(p.value), p.probability]))
          : null,
      };
    } else {
      out[a.name] = { type: "refusal", message: a.refusal ?? a.message ?? null };
    }
  }
  const usage = envelope.data.usage;
  return {
    answers: out,
    usage: {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      costUsd: null,
    },
    servedModel: envelope.data.model ?? null,
  };
}

export function parseDecisionResponse(wire: DecisionWire, bodyText: string): DecisionResult {
  return wire === "decisions" ? parseDecisionsResponse(bodyText) : parseQuestionsResponse(bodyText);
}

// ── the one network call ─────────────────────────────────────────────────────

export interface CallDecisionInput {
  modelId: string;
  state: DecisionState;
  questions: Record<string, DecisionQuestion>;
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** One decision call. Throws `DecisionError` on a non-2xx, a transport failure,
 *  a malformed envelope, or a question the model returned no answer for. */
export async function callDecision(input: CallDecisionInput): Promise<DecisionResult> {
  const { modelId, questions, baseUrl, signal, fetchImpl = fetch } = input;
  const request = buildDecisionRequest(input);
  const url = `${baseUrl.replace(/\/+$/, "")}${request.path}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      ...(signal && { signal }),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    throw new DecisionError(
      0,
      timedOut ? "timeout" : err instanceof Error ? err.message : String(err),
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new DecisionError(
      response.status,
      `HTTP ${response.status}: ${text.slice(0, 200)}`,
      text,
    );
  }

  const result = parseDecisionResponse(routeFor(modelId).wire, text);
  for (const name of Object.keys(questions)) {
    if (!(name in result.answers)) throw malformed(`no answer for question "${name}"`, text);
  }
  return result;
}
