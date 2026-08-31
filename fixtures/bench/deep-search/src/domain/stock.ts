/** How many units of a SKU are available to promise. */
export function availableToPromise(onHand: number, reserved: number): number {
  return Math.max(0, onHand - reserved);
}

/** True when a line can be fulfilled from stock. */
export function canFulfil(onHand: number, reserved: number, wanted: number): boolean {
  return availableToPromise(onHand, reserved) >= wanted;
}
