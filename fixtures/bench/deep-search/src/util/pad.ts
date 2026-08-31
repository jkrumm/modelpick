/** Left-pads `value` with zeroes to `width` characters. */
export function padZero(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Right-pads `value` with spaces to `width` characters. */
export function padRight(value: string, width: number): string {
  return value.padEnd(width, " ");
}
