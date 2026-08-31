/** Renders one CSV field, quoting it only when it has to be quoted. */
export function csvField(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/** Joins `fields` into one CSV row. */
export function csvRow(fields: string[]): string {
  return fields.map(csvField).join(",");
}
