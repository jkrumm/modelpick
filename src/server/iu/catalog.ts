import { z } from "zod";
import { classifyModality, deriveProvider, prettifyName } from "./discover.js";
import { decisionSpec, isDecisionModel } from "../../db/decision-models.js";
import type { Modality, ModelInsert } from "../../db/schema.js";

// The IU gateway's per-leg `GET /models` endpoints return exactly what the
// check-key portal shows. The OpenAI leg carries the metadata (display name,
// vendor, context, capabilities, backend route list); the other legs only say
// which ids they accept. Ids are case-sensitive and taken verbatim.

export const LEGS = ["openai", "anthropic", "gemini", "decisions"] as const;
export type Leg = (typeof LEGS)[number];

const openaiList = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      owned_by: z.string().optional(),
      Human_readable_name: z.string().optional(),
      ContextSize: z.string().optional(),
      Vendor: z.string().optional(),
      Capabilities: z.array(z.string()).optional(),
    }),
  ),
});
const anthropicList = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });
const geminiList = z.object({ models: z.array(z.object({ name: z.string().min(1) })) });
const decisionsList = z.object({ models: z.array(z.object({ name: z.string().min(1) })) });

export type OpenaiEntry = z.infer<typeof openaiList>["data"][number];

/**
 * Ids that are callable and billed on IU but absent from every /models leg, so no listing
 * ever yields them. Add an id only after `make probe` proves it callable; a row with no
 * entry here would never exist and every metric/probe write against it would fail its FK.
 */
export const HIDDEN_CALLABLE: readonly { id: string; leg: Leg; why: string }[] = [
  {
    id: "claude-haiku-5-5-eu",
    leg: "anthropic",
    why: "Bedrock eu-west-1; callable and billed, in /models of no leg (haiku-5-5-hermes-findings)",
  },
];

export interface LegListings {
  openai: OpenaiEntry[];
  anthropic: string[];
  gemini: string[];
  decisions: string[];
}

/** Parsers for the raw JSON of each leg, kept apart from the fetching so they test offline. */
export const parseLeg = {
  openai: (raw: unknown): OpenaiEntry[] => openaiList.parse(raw).data,
  anthropic: (raw: unknown): string[] => anthropicList.parse(raw).data.map((m) => m.id),
  // Gemini names are `models/<id>`.
  gemini: (raw: unknown): string[] =>
    geminiList.parse(raw).models.map((m) => m.name.replace(/^models\//, "")),
  decisions: (raw: unknown): string[] => decisionsList.parse(raw).models.map((m) => m.name),
};

async function getJson(base: string | undefined, name: string, headers: Record<string, string>) {
  if (!base) throw new Error(`${name} base URL is not set`);
  const resp = await fetch(`${base.replace(/\/+$/, "")}/models`, { headers });
  if (!resp.ok) throw new Error(`IU ${name} /models returned HTTP ${resp.status}`);
  return (await resp.json()) as unknown;
}

/** Fetches all four legs. Any leg failing throws: a partial listing would mark live ids as vanished. */
export async function fetchLegListings(env: NodeJS.ProcessEnv = process.env): Promise<LegListings> {
  const key = env["IU_API_KEY"] ?? "";
  const [openai, anthropic, gemini, decisions] = await Promise.all([
    getJson(env["IU_OPENAI_BASE_URL"], "OpenAI", { Authorization: `Bearer ${key}` }),
    getJson(env["IU_ANTHROPIC_BASE_URL"], "Anthropic", {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    getJson(env["IU_GEMINI_BASE_URL"], "Gemini", { "x-goog-api-key": key }),
    getJson(env["IU_DECISIONS_BASE_URL"], "Decisions", { Authorization: `Bearer ${key}` }),
  ]);
  return {
    openai: parseLeg.openai(openai),
    anthropic: parseLeg.anthropic(anthropic),
    gemini: parseLeg.gemini(gemini),
    decisions: parseLeg.decisions(decisions),
  };
}

/** Modality from the capability list; ids with no capabilities fall back to the id heuristic. */
export function modalityFromCapabilities(id: string, caps: readonly string[] | undefined): Modality {
  if (isDecisionModel(id)) return "decision";
  if (!caps || caps.length === 0) return classifyModality(id);
  const has = (c: string) => caps.includes(c);
  if (has("Embedding")) return "embedding";
  if (has("ImageGeneration")) return "image";
  if (has("VoiceOutput")) return "tts";
  if (!has("ChatCompletion") && !has("Responses") && (has("VoiceInput") || has("AudioInput"))) {
    return "stt";
  }
  return "llm";
}

function parseContext(s: string | undefined): number | null {
  const n = Number.parseInt(s ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Merges the legs by exact id into catalog rows. The OpenAI leg is the metadata
 * source; ids that only another leg lists (Gemini aliases, decision models) get
 * an id-derived row. Output is sorted by id so the committed snapshot diffs cleanly.
 */
export function mergeLegs(listings: LegListings): ModelInsert[] {
  const rows = new Map<string, ModelInsert>();
  const legsOf = new Map<string, Set<Leg>>();
  const mark = (id: string, leg: Leg) => {
    const set = legsOf.get(id) ?? new Set<Leg>();
    set.add(leg);
    legsOf.set(id, set);
  };

  for (const m of listings.openai) {
    mark(m.id, "openai");
    rows.set(m.id, {
      id: m.id,
      provider: m.Vendor?.trim() ? m.Vendor.trim().toLowerCase() : deriveProvider(m.id),
      family: null,
      modality: modalityFromCapabilities(m.id, m.Capabilities),
      display_name: m.Human_readable_name?.trim() || prettifyName(m.id),
      context_window: parseContext(m.ContextSize),
      iu_listed: true,
      owned_by: m.owned_by?.trim() || null,
    });
  }
  for (const leg of ["anthropic", "gemini", "decisions"] as const) {
    for (const id of listings[leg]) {
      mark(id, leg);
      if (rows.has(id)) continue;
      rows.set(id, {
        id,
        provider: deriveProvider(id),
        family: null,
        modality: modalityFromCapabilities(id, undefined),
        display_name: prettifyName(id),
        context_window: null,
        iu_listed: true,
        owned_by: null,
      });
    }
  }

  for (const h of HIDDEN_CALLABLE) {
    if (rows.has(h.id)) continue; // the API caught up
    mark(h.id, h.leg);
    rows.set(h.id, {
      id: h.id,
      provider: deriveProvider(h.id),
      family: null,
      modality: modalityFromCapabilities(h.id, undefined),
      display_name: prettifyName(h.id),
      context_window: null,
      iu_listed: true,
      owned_by: null,
    });
  }

  return [...rows.values()]
    .map((r) => {
      // Registered decision models keep the identity decision-models.ts gives them.
      const spec = decisionSpec(r.id);
      const identity = spec
        ? { provider: spec.provider, family: "decision", display_name: spec.display_name }
        : {};
      return { ...r, ...identity, legs: LEGS.filter((l) => legsOf.get(r.id)?.has(l)).join(",") };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface CatalogDiff {
  added: string[];
  removed: string[];
}

export function diffCatalog(previousIds: readonly string[], next: readonly { id: string }[]): CatalogDiff {
  const prev = new Set(previousIds);
  const cur = new Set(next.map((m) => m.id));
  return {
    added: [...cur].filter((id) => !prev.has(id)).sort(),
    removed: [...prev].filter((id) => !cur.has(id)).sort(),
  };
}
