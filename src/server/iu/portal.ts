import { classifyModality, deriveProvider, prettifyName } from "./discover.js";
import type { ModelInsert } from "../../db/schema.js";

// The IU self-service portal (ue-self-service.app.iu-it.org) is a Blazor Server
// app behind SSO — its model table can't be fetched programmatically. Instead we
// parse the saved HTML export of the model-list view. The markup is HTML-entity
// encoded MudBlazor table rows: each model has an "id" row (no spaces, e.g.
// "claude-opus-4-5-20251101") and a separate friendly detail row carrying Vendor,
// Context Size and Capabilities. Row order is irregular, so id rows are the
// authoritative catalog and metadata is attached best-effort from nearby rows —
// but only from a row whose name matches the id (see displayNameScore).

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface PortalRow {
  name: string;
  vendor: string;
  context: string;
  caps: string;
}

function extractRows(decoded: string): PortalRow[] {
  const rowRe = /<tr[^>]*class="mud-table-row"[^>]*>([\s\S]*?)<\/tr>/g;
  const tdRe = /<td[^>]*data-label="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g;
  const rows: PortalRow[] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(decoded)) !== null) {
    const cells: Record<string, string> = {};
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = tdRe.exec(rowMatch[1] ?? "")) !== null) {
      cells[cellMatch[1] ?? ""] = stripTags(cellMatch[2] ?? "");
    }
    rows.push({
      name: cells["Model Name"] ?? "",
      vendor: cells["Vendor"] ?? "",
      context: cells["Context Size"] ?? "",
      caps: cells["Capabilities"] ?? "",
    });
  }
  return rows;
}

const isApiId = (s: string): boolean => s.length > 0 && !/\s/.test(s);

// Words that change what a model *is*. If one appears on only one side of an
// id/display-name pair, the pair is two different models (gpt-5.5-pro vs "GPT-5.5",
// o1-2024-12-17 vs "o1 Pro EU"), however much else they share.
const QUALIFIERS = new Set([
  "mini", "nano", "pro", "flash", "lite", "max", "sonnet", "opus", "haiku", "fast", "ultra",
  "luna", "sol", "terra", "astra", "fable", "codex", "chat", "image", "tts", "transcribe",
  "embed", "embedding", "instruct", "thinking", "reasoning", "code", "coder", "vision",
  "realtime", "audio", "live", "search", "diarize", "translate", "research", "deep",
  "moderation", "ocr", "customtools", "computer", "turbo", "medium", "small", "large", "hd",
]);
const NOISE = new Set(["preview", "latest", "by"]);

interface NameTokens {
  nums: string[];
  words: Set<string>;
}

function tokenize(raw: string): NameTokens {
  const base = raw.includes("/") ? raw.split("/").slice(1).join("/") : raw;
  const text = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b20\d{2} \d{2} \d{2}\b/g, " ") // 2024-11-20
    .replace(/\b20\d{6}\b/g, " ") // 20251101
    .replace(/\b\d{2} 20\d{2}\b/g, " ") // preview-10-2025
    .trim();
  const nums: string[] = [];
  const words = new Set<string>();
  for (const word of text.split(" ")) {
    if (!word) continue;
    if (/^a?\d+b$/.test(word)) continue; // parameter counts: 120b, a12b
    if (/^2[3-9](0[1-9]|1[0-2])$/.test(word)) continue; // YYMM release stamp: 2512
    if (/^(0[1-9]|1[0-2])([0-2]\d|3[01])$/.test(word)) continue; // MMDD stamp: 0125
    if (/^00\d$/.test(word)) continue; // revision: 001
    for (const part of word.match(/[a-z]+|\d+/g) ?? []) {
      if (/^\d/.test(part)) nums.push(String(Number.parseInt(part, 10)));
      else if (!NOISE.has(part)) words.add(part);
    }
  }
  return { nums, words };
}

/**
 * How well a portal display name describes an API id, or null when it describes a
 * different model: version numbers must agree exactly (id `5-5` ↔ "5.5", date and
 * parameter-count suffixes ignored), qualifier words must agree on both sides, and
 * at least one word must be shared. Higher is better; unmatched words cost a point.
 */
export function displayNameScore(id: string, name: string): number | null {
  const a = tokenize(id);
  const b = tokenize(name);
  if (a.nums.join(".") !== b.nums.join(".")) return null;
  let shared = 0;
  let extra = 0;
  for (const w of b.words) {
    if (a.words.has(w)) shared++;
    else if (QUALIFIERS.has(w)) return null;
    else extra++;
  }
  for (const w of a.words) {
    if (b.words.has(w)) continue;
    if (QUALIFIERS.has(w)) return null;
    extra++;
  }
  return shared > 0 ? shared * 2 - extra : null;
}

/** Parses a saved IU self-service model-list HTML export into catalog rows. */
export function parsePortalHtml(html: string): ModelInsert[] {
  const rows = extractRows(decodeEntities(html));
  const out = new Map<string, ModelInsert>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !isApiId(row.name) || out.has(row.name)) continue;

    // Display name and context come from ONE row: the id row itself when it carries
    // the metadata, else the best-matching friendly row within two places of it. The
    // table order is irregular, so a neighbour is only trusted when its name
    // describes this id; otherwise the name is prettified and the context left null.
    let display = prettifyName(row.name);
    let context = row.caps ? parseContext(row.context) : null;
    if (!row.caps) {
      let best = Number.NEGATIVE_INFINITY;
      for (const j of [i + 1, i - 1, i + 2, i - 2]) {
        const f = rows[j];
        if (!f || !f.caps || f.name === row.name) continue;
        const score = displayNameScore(row.name, f.name);
        if (score === null || score <= best) continue;
        best = score;
        display = f.name;
        context = parseContext(f.context);
      }
    }

    out.set(row.name, {
      id: row.name,
      provider: deriveProvider(row.name),
      family: null,
      modality: classifyModality(row.name),
      display_name: display,
      context_window: context,
      iu_listed: true,
    });
  }

  return [...out.values()];
}

function parseContext(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
