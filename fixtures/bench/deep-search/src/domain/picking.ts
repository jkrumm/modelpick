/** The pick path for a list of bin codes, walked in aisle order. */
export function pickPath(bins: string[]): string[] {
  return [...bins].sort((a, b) => a.localeCompare(b));
}
