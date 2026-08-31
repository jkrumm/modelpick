/** A single position on an order. */
export interface OrderLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

/** A customer order as stored. */
export interface Order {
  id: string;
  customer: string;
  currency: string;
  lines: OrderLine[];
  discountRatio: number;
}
