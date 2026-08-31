/** The v2 order payload, as the old workers wrote it. */
export interface V2Order {
  order_id: string;
  total_cents: number;
  mode: string;
}

/** True when a v2 payload is complete enough to migrate. */
export function isMigratable(order: V2Order): boolean {
  return order.order_id.length > 0 && Number.isFinite(order.total_cents);
}
