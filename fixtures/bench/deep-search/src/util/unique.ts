/** The distinct members of `items`, in first-seen order. */
export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** True when `items` holds no duplicates. */
export function allDistinct<T>(items: T[]): boolean {
  return new Set(items).size === items.length;
}
