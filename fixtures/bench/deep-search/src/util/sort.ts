/** Sorts by a numeric key, ascending, without touching the input. */
export function sortByNumber<T>(items: T[], keyOf: (item: T) => number): T[] {
  return [...items].sort((a, b) => keyOf(a) - keyOf(b));
}

/** Sorts by a string key, ascending, without touching the input. */
export function sortByText<T>(items: T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}
