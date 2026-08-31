/** A discount voucher. */
export interface Voucher {
  code: string;
  ratio: number;
  minimumCents: number;
}

/** True when a voucher applies to a basket of `totalCents`. */
export function voucherApplies(voucher: Voucher, totalCents: number): boolean {
  return totalCents >= voucher.minimumCents;
}
