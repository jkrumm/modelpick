/** German standard VAT rate. */
export const VAT_RATE = 0.19;

/** The VAT share of a net amount, in cents. */
export function vatCents(netCents: number): number {
  return Math.round(netCents * VAT_RATE);
}

/** Net plus VAT, in cents. */
export function grossCents(netCents: number): number {
  return netCents + vatCents(netCents);
}
