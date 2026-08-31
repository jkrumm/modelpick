import { apiBaseUrl } from "../../config/http.ts";
import { normalize } from "../../util/text.ts";
import { CATALOG } from "./data.ts";

/** Catalogue entries whose name contains `query`, case-insensitively. */
export function searchCatalog(query: string): string[] {
  const needle = normalize(query);
  return CATALOG.filter((item) => normalize(item).includes(needle));
}

/** The canonical URL of a catalogue entry. */
export function catalogUrl(item: string): string {
  return `${apiBaseUrl()}/catalog/${item}`;
}
