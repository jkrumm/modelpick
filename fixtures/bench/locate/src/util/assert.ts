/** Throws when `value` is not a finite number. */
export function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

/** Throws when `value` is not a safe integer. */
export function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer`);
  }
}
