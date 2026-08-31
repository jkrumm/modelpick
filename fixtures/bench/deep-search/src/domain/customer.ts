/** A customer record. */
export interface Customer {
  id: string;
  name: string;
  countryCode: string;
}

/** True when the customer is inside the EU VAT area. */
export function isEuCustomer(customer: Customer): boolean {
  return EU.includes(customer.countryCode);
}

const EU = ["AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "PL", "PT", "SE"];
