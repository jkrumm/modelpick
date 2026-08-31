/** Compares two strings for a stable ascending sort. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Compares two numbers for a stable ascending sort. */
export function compareNumber(a: number, b: number): number {
  return a - b;
}
