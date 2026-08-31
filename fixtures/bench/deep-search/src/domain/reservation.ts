/** A stock reservation held for a basket. */
export interface Reservation {
  sku: string;
  quantity: number;
  heldUntil: string;
}

/** True when the reservation has not expired at `now`. */
export function stillHeld(reservation: Reservation, now: string): boolean {
  return reservation.heldUntil > now;
}
