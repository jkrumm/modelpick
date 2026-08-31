/** Clamps `index` to a position that is valid in an array of `length` items. */
export function clampIndex(index: number, length: number): number {
  if (length === 0) return -1;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/** Consecutive windows of `size` items, advancing by `step` each time. */
export function windows<T>(items: T[], size: number, step: number): T[][] {
  if (size <= 0 || step <= 0) throw new RangeError("size and step must be positive");
  const out: T[][] = [];
  for (let start = 0; start + size <= items.length; start += step) {
    out.push(items.slice(start, start + size));
  }
  return out;
}
