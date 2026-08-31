/** The lifecycle states an order moves through. */
export type OrderStatus = "draft" | "placed" | "picked" | "shipped" | "closed";

const NEXT: Record<OrderStatus, OrderStatus | null> = {
  draft: "placed",
  placed: "picked",
  picked: "shipped",
  shipped: "closed",
  closed: null,
};

/** The state that follows `status`, or null at the end of the lifecycle. */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  return NEXT[status];
}
