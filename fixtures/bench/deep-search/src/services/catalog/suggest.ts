import { normalize } from "../../util/text.ts";

/** Up to `limit` catalogue entries that start with `prefix`. */
export function suggest(items: string[], prefix: string, limit: number): string[] {
  const needle = normalize(prefix);
  return items.filter((item) => normalize(item).startsWith(needle)).slice(0, limit);
}
