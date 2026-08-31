import { log } from "./log.ts";
import { missingColumns, REQUIRED_COLUMNS, type Row } from "./rows.ts";

/** Renders one cell, quoting only when the text needs it. */
function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : value;
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Encodes `rows` as CSV: a fixed `id,name,email` header followed by one line
 * per row, joined with `\n` and with no trailing newline. Every row missing a
 * required column produces exactly one warning naming that row and the columns
 * it lacks.
 */
export function toCsv(rows: Row[]): string {
  const lines: string[] = [REQUIRED_COLUMNS.join(",")];
  for (const row of rows) {
    const missing = missingColumns(row);
    if (missing.length > 0) {
      log("warn", `row ${field(row["id"]) || "<no id>"} is missing ${missing.join(", ")}`);
    }
    lines.push(REQUIRED_COLUMNS.map((column) => field(row[column])).join(","));
  }
  return lines.join("\n");
}
