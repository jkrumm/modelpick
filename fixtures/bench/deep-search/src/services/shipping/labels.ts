import { slugify } from "../../util/slug.ts";

/** The file name a shipping label is stored under. */
export function labelFileName(orderId: string, carrier: string): string {
  return `${slugify(carrier)}-${orderId}.pdf`;
}
