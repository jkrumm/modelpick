import { log } from "./log.ts";

/** A single record. Values are already normalised; a missing cell is null. */
export interface Row {
  [column: string]: string | number | null | undefined;
}

/** The columns every export must carry, in the order they are written. */
export const REQUIRED_COLUMNS: readonly string[] = ["id", "name", "email"];

/** True when `value` carries nothing usable for an export cell. */
export function isBlank(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || value === "";
}

/** The required columns `row` does not fill, in required-column order. */
export function missingColumns(row: Row): string[] {
  return REQUIRED_COLUMNS.filter((column) => isBlank(row[column]));
}

/** Every distinct column name across `rows`, in first-seen order. */
export function columnsOf(rows: Row[]): string[] {
  if (rows.length === 0) {
    log("warn", "columnsOf received no rows");
    return [];
  }
  const seen: string[] = [];
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!seen.includes(column)) seen.push(column);
    }
  }
  return seen;
}
