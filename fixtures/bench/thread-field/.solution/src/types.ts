/** An order row exactly as the warehouse export delivers it. */
export interface RawOrder {
  id: string;
  customer_name: string;
  total_cents: number;
  discount_cents?: number | null;
}

/** An order in the shape the report layer expects. */
export interface Order {
  id: string;
  customerName: string;
  totalCents: number;
  discountCents: number;
}
