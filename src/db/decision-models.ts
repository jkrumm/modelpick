import type { ModelInsert } from "./schema.js";

/**
 * The decision models — typed-answer classifiers that answer yes/no, choice and
 * score questions with probabilities and never generate text. The IU /models
 * list and the portal export carry some of them as ordinary chat models
 * (provider "other"), so the id is the only reliable signal: this table is the
 * one place that says which ids are decision models and how each is reached.
 * IU's own decision list, `GET {IU_DECISIONS_BASE_URL}/models`, is the discovery
 * source for new ones (probe.ts warns about any id missing here).
 *
 * Pure data, no DB or network import — `classifyModality` (discover.ts), the seed
 * and the decision client all read it.
 */

/** Wire a decision model is called on. `systemone` = IU's native decision API
 *  `POST {IU_DECISIONS_BASE_URL}/systemone` (Clef, Decision-1, PPLX, Jev);
 *  `decisions` = the OpenAI Decisions API route `POST /decisions` (GPT-6 Luna). */
export type DecisionWire = "systemone" | "decisions";

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
  /** USD per 1M tokens, for a wire that reports no cost and a model no collector
   *  prices. Researched and dated at the entry; absent = the collected rate card. */
  rate?: { input: number; output: number };
}

export const DECISION_MODELS: readonly DecisionModelSpec[] = [
  {
    id: "clef",
    wire: "systemone",
    provider: "cloudflare",
    display_name: "Clef",
    region: null,
    iu_listed: true,
    note: "Cloudflare 27B, routed Global or EU",
  },
  {
    id: "clef-eu",
    wire: "systemone",
    provider: "cloudflare",
    display_name: "Clef (EU)",
    region: "eu",
    iu_listed: true,
    note: "Cloudflare 27B, EU-hosted only",
  },
  {
    id: "clef-flash",
    wire: "systemone",
    provider: "cloudflare",
    display_name: "Clef Flash",
    region: null,
    iu_listed: true,
    note: "Cloudflare 9B, Global",
  },
  {
    id: "pplx-decider-v1-27b",
    wire: "systemone",
    provider: "perplexity",
    display_name: "PPLX Decider v1 27B",
    region: null,
    iu_listed: true,
    note: "Perplexity 27B decider, Global",
  },
  {
    id: "jev-latest",
    wire: "systemone",
    provider: "other",
    display_name: "Jev (latest)",
    region: null,
    iu_listed: true,
    note: "Alias of jev-1.13.0; on the decisions model list, absent from the chat /models",
  },
  {
    id: "jev-1.13.0",
    wire: "systemone",
    provider: "other",
    display_name: "Jev 1.13.0",
    region: null,
    iu_listed: true,
    note: "Pinned version behind jev-latest; on the decisions model list, absent from the chat /models",
  },
  {
    id: "decision-1",
    wire: "systemone",
    // Published 2026-10-09: $0.042/1M input, output free. No collector lists it.
    rate: { input: 0.042, output: 0 },
    provider: "microsoft",
    display_name: "Decision-1",
    region: null,
    iu_listed: true,
    note: "Microsoft decision-1, Global — served from Azure centralus (2026-10-13)",
  },
  {
    id: "decision-1-eu",
    wire: "systemone",
    // Published 2026-10-09: $0.042/1M input, output free. No collector lists it.
    rate: { input: 0.042, output: 0 },
    provider: "microsoft",
    display_name: "Decision-1 (EU)",
    region: "eu",
    iu_listed: true,
    note: "Microsoft decision-1, EU deployment (Azure swedencentral)",
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

/** A name some registered model puts on the wire — the catalog id or its
 *  `apiModel` (`gpt-6-luna` for `gpt-6-luna:decisions`). */
export function isKnownDecisionName(name: string): boolean {
  return BY_ID.has(name) || DECISION_MODELS.some((m) => m.apiModel === name);
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
