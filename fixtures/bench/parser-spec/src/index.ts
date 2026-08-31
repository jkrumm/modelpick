/** Collapses every run of whitespace in `input` into a single space. */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Splits `input` on commas, trimming each part and dropping empty ones. */
export function splitList(input: string): string[] {
  return input
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
