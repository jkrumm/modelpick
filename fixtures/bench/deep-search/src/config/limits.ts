/** How many days a refund request stays open. */
export function refundWindowDays(): number {
  const raw = process.env.REFUND_WINDOW_DAYS;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 30 : parsed;
}

/** The largest parcel weight the shipping API accepts, in grams. */
export function maxParcelGrams(): number {
  return 31_500;
}

/** The largest page size the catalogue API will serve. */
export function maxPageSize(): number {
  return 200;
}
