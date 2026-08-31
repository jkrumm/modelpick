/** The ISO date part of a timestamp string. */
export function isoDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** True when two timestamps fall on the same ISO date. */
export function sameDay(a: string, b: string): boolean {
  return isoDate(a) === isoDate(b);
}
