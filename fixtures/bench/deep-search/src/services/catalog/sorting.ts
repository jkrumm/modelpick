import { sortByText } from "../../util/sort.ts";

/** Catalogue entries in display order. */
export function displayOrder(items: string[]): string[] {
  return sortByText(items, (item) => item);
}
