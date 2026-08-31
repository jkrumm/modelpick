/** Left-pads `value` with zeroes to `width` characters. */
export function padZero(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Renders the sub-euro remainder of an amount as a two-digit string. */
export function padCents(remainder: number): string {
  return padZero(remainder, 2);
}
