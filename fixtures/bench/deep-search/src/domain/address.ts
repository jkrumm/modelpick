/** A postal address. */
export interface Address {
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
}

/** The address rendered as a single line. */
export function oneLine(address: Address): string {
  return `${address.street}, ${address.postalCode} ${address.city}, ${address.countryCode}`;
}
