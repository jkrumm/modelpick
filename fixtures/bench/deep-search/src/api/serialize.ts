import { flagEnabled } from "../config/flags.ts";

/** Renders a response body as JSON, pretty-printed when the flag is on. */
export function serialize(value: unknown): string {
  return flagEnabled("pretty-json") ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}
