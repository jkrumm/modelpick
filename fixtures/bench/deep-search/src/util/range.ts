/** The integers from `start` (inclusive) to `end` (exclusive). */
export function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let value = start; value < end; value++) out.push(value);
  return out;
}
