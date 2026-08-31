import type { Order, RawOrder } from "./types.ts";

/** Maps one raw export row onto the domain shape. */
export function toOrder(raw: RawOrder): Order {
  return {
    id: raw.id,
    customerName: raw.customer_name,
    totalCents: raw.total_cents,
    discountCents: raw.discount_cents ?? 0,
  };
}

/** Maps a whole export batch. */
export function toOrders(raws: RawOrder[]): Order[] {
  return raws.map(toOrder);
}
