/** One page of a larger result set. */
export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

/** Slices `items` into the requested page. Pages are 1-based. */
export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const first = Math.max(0, (page - 1) * size);
  return { items: items.slice(first, first + size), page, size, total: items.length };
}
