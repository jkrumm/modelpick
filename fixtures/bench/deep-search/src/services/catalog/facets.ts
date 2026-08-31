import { CATALOG } from "./data.ts";

/** How many catalogue entries start with each letter. */
export function facetCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of CATALOG) {
    const key = item.slice(0, 1);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
