/** Milliseconds per accepted unit. `m` is minutes; `ms` is milliseconds. */
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i;

/**
 * Turns `<number><unit>` into a whole number of milliseconds.
 *
 * Throws a `TypeError` for anything the grammar does not accept: an empty
 * string, a bare number, an unknown or missing unit, a sign, or whitespace
 * between the number and the unit.
 */
export function parseDuration(input: string): number {
  const match = DURATION.exec(input.trim());
  if (!match) throw new TypeError(`not a duration: ${JSON.stringify(input)}`);
  const amount = Number(match[1]);
  const factor = UNIT_MS[(match[2] ?? "").toLowerCase()];
  if (!Number.isFinite(amount) || factor === undefined) {
    throw new TypeError(`not a duration: ${JSON.stringify(input)}`);
  }
  return Math.round(amount * factor);
}
