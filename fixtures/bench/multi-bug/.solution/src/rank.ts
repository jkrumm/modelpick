import type { Entry } from "./types.ts";

/** Entries ordered by score descending, ties broken by name ascending. */
export function rank(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) =>
    b.score === a.score ? a.name.localeCompare(b.name) : b.score - a.score,
  );
}

/** The `count` highest-ranked entries. */
export function topN(entries: Entry[], count: number): Entry[] {
  return rank(entries).slice(0, count);
}
