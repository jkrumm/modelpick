/** True when `sku` matches the house format `AA-0000`. */
export function isValidSku(sku: string): boolean {
  return /^[A-Z]{2}-\d{4}$/.test(sku);
}

/** The product family a SKU belongs to. */
export function familyOf(sku: string): string {
  return sku.slice(0, 2);
}
