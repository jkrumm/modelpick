import { maxPageSize } from "../../config/limits.ts";
import { paginate } from "../../util/paginate.ts";
import type { Page } from "../../util/paginate.ts";
import { CATALOG } from "./data.ts";

/** One page of the catalogue. */
export function catalogPage(page: number, size: number): Page<string> {
  return paginate(CATALOG, page, Math.min(size, maxPageSize()));
}

/** How many items the catalogue holds. */
export function catalogSize(): number {
  return CATALOG.length;
}
