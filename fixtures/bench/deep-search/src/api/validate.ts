/** Throws when `value` is not a positive finite number. */
export function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive number`);
  }
}

/** Throws when `value` is an empty string. */
export function requireText(value: string, label: string): void {
  if (value.trim().length === 0) throw new RangeError(`${label} must not be empty`);
}
