const COUNTERS = new Map<string, number>();

/** Increments a named counter. */
export function increment(name: string, by = 1): void {
  COUNTERS.set(name, (COUNTERS.get(name) ?? 0) + by);
}

/** A snapshot of every counter. */
export function snapshot(): Record<string, number> {
  return Object.fromEntries(COUNTERS);
}
