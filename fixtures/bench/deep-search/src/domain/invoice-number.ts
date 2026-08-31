import { padZero } from "../util/pad.ts";

/** The invoice number for a sequence position in a given year. */
export function invoiceNumber(year: number, sequence: number): string {
  return `${year}-${padZero(sequence, 6)}`;
}
