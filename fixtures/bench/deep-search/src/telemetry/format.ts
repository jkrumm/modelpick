/** Renders a structured log record as one line of `key=value` pairs. */
export function formatRecord(record: Record<string, string | number>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
