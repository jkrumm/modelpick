/** How many pages `total` items fill at `pageSize` items per page. */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) throw new TypeError("pageSize must be positive");
  return Math.ceil(total / pageSize);
}

/** The items on `page` (1-based) when paging `items` at `pageSize` per page. */
export function pageSlice<T>(items: T[], page: number, pageSize: number): T[] {
  if (page < 1) throw new TypeError("page is 1-based");
  const first = (page - 1) * pageSize;
  const last = first + pageSize;
  return items.slice(first, last + 1);
}

/** True when `page` is the final page of `total` items. */
export function isLastPage(total: number, page: number, pageSize: number): boolean {
  return page >= pageCount(total, pageSize);
}
