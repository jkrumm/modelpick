import { classifyModality, deriveProvider, prettifyName } from "./discover.js";
import type { ModelInsert } from "../../db/schema.js";

// The IU self-service portal (ue-self-service.app.iu-it.org) is a Blazor Server
// app behind SSO — its model table can't be fetched programmatically. Instead we
// parse the saved HTML export of the model-list view. The markup is HTML-entity
// encoded MudBlazor table rows: each model has an "id" row (no spaces, e.g.
// "claude-opus-4-5-20251101") and a separate friendly detail row carrying Vendor,
// Context Size and Capabilities. Row order is irregular, so id rows are the
// authoritative catalog and metadata is attached best-effort from nearby rows.

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

/** Parses a saved IU self-service model-list HTML export into catalog rows. */
export function parsePortalHtml(html: string): ModelInsert[] {
  const rows = extractRows(decodeEntities(html));
  const out = new Map<string, ModelInsert>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !isApiId(row.name) || out.has(row.name)) continue;

    // Pull context/display from the nearest friendly (caps-bearing) row.
    let context: number | null = null;
    let display = prettifyName(row.name);
    for (const j of [i + 1, i - 1, i + 2, i - 2]) {
      const f = rows[j];
      if (!f || !f.caps) continue;
      const n = Number.parseInt(f.context, 10);
      if (Number.isFinite(n) && n > 0) context = n;
      if (f.name && /\s/.test(f.name)) display = f.name;
      break;
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
