import type { Customer } from "./customer.ts";

/** True when a customer may pay on invoice. */
export function mayPayOnInvoice(customer: Customer, ordersPlaced: number): boolean {
  return ordersPlaced >= 3 && customer.countryCode === "DE";
}
