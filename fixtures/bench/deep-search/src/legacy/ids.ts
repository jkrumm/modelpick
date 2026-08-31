/** The v2 order id format: `L-` plus a zero-padded counter. */
export function legacyOrderId(counter: number): string {
  return `L-${String(counter).padStart(8, "0")}`;
}
