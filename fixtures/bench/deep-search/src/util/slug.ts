import { normalize } from "./text.ts";

/** A URL-safe slug for `input`. */
export function slugify(input: string): string {
  return normalize(input)
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}
