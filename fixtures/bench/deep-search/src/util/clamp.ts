/** Restricts `value` to the inclusive range [`min`, `max`]. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Restricts a ratio to [0, 1]. */
export function clampRatio(value: number): number {
  return clamp(value, 0, 1);
}
