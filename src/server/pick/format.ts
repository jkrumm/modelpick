// Builds the merged comparison rows (live probe > cached DB row > seed
// fallback) and renders them as a plain padded-column table (never a
// box-drawn one — see dotfiles/rules/formatting.md) or JSON.
import type { PickProbe } from "../../db/schema.js";
import type { PickProbeResult } from "./probe.js";
import {
  SEED_PRICES,
  KNOWN_IGNORES_MAX_TOKENS,
  KNOWN_CONTEXT_WINDOW,
  ALWAYS_THINKING_DEFAULT,
} from "./seed-prices.js";

export interface ComparisonRow {
  modelId: string;
  priceInPerM: number | null;
  priceOutPerM: number | null;
  priceCacheReadPerM: number | null;
  supportsCacheRead: boolean | null;
  honorsMaxTokens: boolean | null;
  alwaysThinking: boolean | null;
  contextWindow: number | null;
  contextWindowExact: boolean;
  source: "live" | "cached" | "seed";
  notes: string[];
}

/** Merges a fresh live probe result into a comparison row. */
export function rowFromLiveProbe(result: PickProbeResult): ComparisonRow {
  return {
    modelId: result.modelId,
    priceInPerM: result.priceInPerM,
    priceOutPerM: result.priceOutPerM,
    priceCacheReadPerM: result.priceCacheReadPerM,
    supportsCacheRead: result.supportsCacheRead,
    honorsMaxTokens: result.honorsMaxTokens,
    alwaysThinking: result.alwaysThinking,
    contextWindow: result.contextWindow,
    contextWindowExact: result.contextWindowExact,
    source: "live",
    notes: result.notes,
  };
}

/** Builds a comparison row from a previously cached pick_probe DB row. */
export function rowFromCache(row: PickProbe): ComparisonRow {
  return {
    modelId: row.model_id,
    priceInPerM: row.price_in_per_m,
    priceOutPerM: row.price_out_per_m,
    priceCacheReadPerM: row.price_cache_read_per_m,
    supportsCacheRead: row.supports_cache_read,
    honorsMaxTokens: row.honors_max_tokens,
    alwaysThinking: row.always_thinking,
    contextWindow: row.context_window,
    contextWindowExact: row.context_window_exact,
    source: "cached",
    notes: row.notes ? row.notes.split(" | ") : [],
  };
}

/** Builds a comparison row purely from the baked-in seed table + known
 *  quirks, for a model that has never been probed. */
export function rowFromSeed(modelId: string): ComparisonRow {
  const seed = SEED_PRICES[modelId];
  return {
    modelId,
    priceInPerM: seed?.priceInPerM ?? null,
    priceOutPerM: seed?.priceOutPerM ?? null,
    priceCacheReadPerM: seed?.priceCacheReadPerM ?? null,
    supportsCacheRead: seed ? seed.priceCacheReadPerM !== null : null,
    honorsMaxTokens: KNOWN_IGNORES_MAX_TOKENS.has(modelId) ? false : null,
    alwaysThinking: ALWAYS_THINKING_DEFAULT,
    contextWindow: KNOWN_CONTEXT_WINDOW[modelId] ?? null,
    contextWindowExact: modelId in KNOWN_CONTEXT_WINDOW,
    source: "seed",
    notes: [],
  };
}

function yesNo(v: boolean | null): string {
  if (v === null) return "—";
  return v ? "yes" : "no";
}

function money(v: number | null): string {
  return v === null ? "—" : `$${v.toFixed(3)}`;
}

function contextLabel(row: ComparisonRow): string {
  if (row.contextWindow === null) return "—";
  const approx = row.contextWindowExact ? "" : "~";
  if (row.contextWindow >= 1000) return `${approx}${Math.round(row.contextWindow / 1000)}k`;
  return `${approx}${row.contextWindow}`;
}

/** One-line verdict summarizing whether a model is a clean pick for an agent
 *  loop (Claude Code needs predictable stop behavior and no forced reasoning
 *  tax on every turn). */
export function verdictFor(row: ComparisonRow): string {
  const bits: string[] = [];
  if (row.priceInPerM === null || row.priceOutPerM === null) bits.push("cost unavailable");
  if (row.honorsMaxTokens === false) bits.push("ignores max_tokens");
  if (row.alwaysThinking) bits.push("always reasons");
  if (row.supportsCacheRead) bits.push("cache-friendly");
  if (bits.length === 0) return "clean — cheap, capped, no forced reasoning";
  return bits.join(", ");
}

/** Usable for an agent loop: known real pricing, and doesn't silently ignore
 *  max_tokens (Claude Code relies on the cap for turn-taking and budgets). */
export function isUsableForAgentLoop(row: ComparisonRow): boolean {
  return row.priceInPerM !== null && row.priceOutPerM !== null && row.honorsMaxTokens !== false;
}

export function sortByOutputPriceAsc(rows: ComparisonRow[]): ComparisonRow[] {
  return rows.toSorted((a, b) => {
    if (a.priceOutPerM === null && b.priceOutPerM === null)
      return a.modelId.localeCompare(b.modelId);
    if (a.priceOutPerM === null) return 1;
    if (b.priceOutPerM === null) return -1;
    return a.priceOutPerM - b.priceOutPerM;
  });
}

const COLUMNS = [
  { key: "model", label: "model", width: 34 },
  { key: "in", label: "$/M in", width: 9 },
  { key: "out", label: "$/M out", width: 9 },
  { key: "cache", label: "$/M cache", width: 10 },
  { key: "caching", label: "caching", width: 8 },
  { key: "maxtok", label: "max_tok", width: 8 },
  { key: "think", label: "thinking", width: 9 },
  { key: "ctx", label: "context", width: 8 },
] as const;

export function renderTable(rows: ComparisonRow[]): string {
  const sorted = sortByOutputPriceAsc(rows);
  const header = COLUMNS.map((c) => c.label.padEnd(c.width)).join("") + "verdict";
  const lines = sorted.map((row) => {
    const cells = [
      row.modelId.padEnd(COLUMNS[0].width),
      money(row.priceInPerM).padEnd(COLUMNS[1].width),
      money(row.priceOutPerM).padEnd(COLUMNS[2].width),
      money(row.priceCacheReadPerM).padEnd(COLUMNS[3].width),
      yesNo(row.supportsCacheRead).padEnd(COLUMNS[4].width),
      yesNo(row.honorsMaxTokens).padEnd(COLUMNS[5].width),
      yesNo(row.alwaysThinking).padEnd(COLUMNS[6].width),
      contextLabel(row).padEnd(COLUMNS[7].width),
    ].join("");
    return `${cells}${verdictFor(row)}`;
  });
  return [header, ...lines].join("\n");
}

export interface ComparisonJson {
  model_id: string;
  price_in_per_m: number | null;
  price_out_per_m: number | null;
  price_cache_read_per_m: number | null;
  supports_cache_read: boolean | null;
  honors_max_tokens: boolean | null;
  always_thinking: boolean | null;
  context_window: number | null;
  context_window_exact: boolean;
  source: ComparisonRow["source"];
  usable_for_agent_loop: boolean;
  verdict: string;
  notes: string[];
}

export function toJson(rows: ComparisonRow[]): ComparisonJson[] {
  return sortByOutputPriceAsc(rows).map((row) => ({
    model_id: row.modelId,
    price_in_per_m: row.priceInPerM,
    price_out_per_m: row.priceOutPerM,
    price_cache_read_per_m: row.priceCacheReadPerM,
    supports_cache_read: row.supportsCacheRead,
    honors_max_tokens: row.honorsMaxTokens,
    always_thinking: row.alwaysThinking,
    context_window: row.contextWindow,
    context_window_exact: row.contextWindowExact,
    source: row.source,
    usable_for_agent_loop: isUsableForAgentLoop(row),
    verdict: verdictFor(row),
    notes: row.notes,
  }));
}

/** The exact shell line to launch Claude Code against a gateway model — `ca`
 *  (dotfiles/config/zsh/claude.zsh) already carries every env var this needs
 *  (IU creds from Keychain, ANTHROPIC_DEFAULT_*_MODEL tiers, context budget),
 *  so the launch line never has to print a credential itself. */
export function launchLine(modelId: string): string {
  return `ca ${modelId}`;
}
