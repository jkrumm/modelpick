import type { ModelInsert } from "./schema.js";

/**
 * The decision models — typed-answer classifiers that answer yes/no, choice and
 * score questions with probabilities and never generate text. The IU /models
 * list and the portal export carry them as ordinary chat models (provider
 * "other"), so the id is the only reliable signal: this table is the one place
 * that says which ids are decision models and how each is reached.
 *
 * Pure data, no DB or network import — `classifyModality` (discover.ts), the seed
 * and the decision client all read it.
 */

/** Wire a decision model is called on. `questions` = chat/completions with
 *  `response_format: { type: "questions" }` (Clef, PPLX, Jev); `decisions` = the
 *  OpenAI Decisions API route `POST /decisions` (GPT-6 Luna). */
export type DecisionWire = "questions" | "decisions";

export interface DecisionModelSpec {
  id: string;
  /** The model name on the wire when it differs from the catalog id. */
  apiModel?: string;
  wire: DecisionWire;
  provider: string;
  display_name: string;
  /** Hosting region where IU documents one; null = not established. */
  region: "eu" | null;
  iu_listed: boolean;
  note: string;
}

export const DECISION_MODELS: readonly DecisionModelSpec[] = [
  {
    id: "clef",
    wire: "questions",
    provider: "cloudflare",
    display_name: "Clef",
    region: null,
    iu_listed: true,
    note: "Cloudflare 27B, routed Global or EU",
  },
  {
    id: "clef-eu",
    wire: "questions",
    provider: "cloudflare",
    display_name: "Clef (EU)",
    region: "eu",
    iu_listed: true,
    note: "Cloudflare 27B, EU-hosted only",
  },
  {
    id: "clef-flash",
    wire: "questions",
    provider: "cloudflare",
    display_name: "Clef Flash",
    region: null,
    iu_listed: true,
    note: "Cloudflare 9B, Global",
  },
  {
    id: "pplx-decider-v1-27b",
    wire: "questions",
    provider: "perplexity",
    display_name: "PPLX Decider v1 27B",
    region: null,
    iu_listed: true,
    note: "Perplexity 27B decider, Global",
  },
  {
    id: "jev-latest",
    wire: "questions",
    provider: "other",
    display_name: "Jev (latest)",
    region: null,
    iu_listed: false,
    note: "Callable on UE but absent from /models; alias of jev-1.13.0",
  },
  {
    id: "jev-1.13.0",
    wire: "questions",
    provider: "other",
    display_name: "Jev 1.13.0",
    region: null,
    iu_listed: false,
    note: "Callable on UE but absent from /models; pinned version behind jev-latest",
  },
  {
    // GPT-6 Luna is BOTH a chat LLM (`gpt-6-luna`, untouched) and reachable on
    // the Decisions API. The suffixed id is a catalog-only entry for that route.
    id: "gpt-6-luna:decisions",
    apiModel: "gpt-6-luna",
    wire: "decisions",
    provider: "openai",
    display_name: "GPT-6 Luna (Decisions API)",
    region: null,
    iu_listed: false,
    note: "Same model as the gpt-6-luna chat entry, reached on POST /decisions",
  },
];

const BY_ID = new Map(DECISION_MODELS.map((m) => [m.id, m]));

export function decisionSpec(modelId: string): DecisionModelSpec | undefined {
  return BY_ID.get(modelId);
}

export function isDecisionModel(modelId: string): boolean {
  return BY_ID.has(modelId);
}

/** Catalog rows for the seed — the upsert is what flips an already-discovered
 *  `clef` row from `llm` to `decision`. */
export const DECISION_CATALOG: ModelInsert[] = DECISION_MODELS.map((m) => ({
  id: m.id,
  provider: m.provider,
  family: "decision",
  modality: "decision",
  display_name: m.display_name,
  context_window: null,
  iu_listed: m.iu_listed,
  transport: "iu",
}));
