/** Lowercases and trims `input` for case-insensitive comparison. */
export function normalize(input: string): string {
  return input.trim().toLowerCase();
}

/** Title-cases the first letter of `input`. */
export function capitalize(input: string): string {
  return input.length === 0 ? input : input[0]!.toUpperCase() + input.slice(1);
}
