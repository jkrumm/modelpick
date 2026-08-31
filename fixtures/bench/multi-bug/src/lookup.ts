import type { Doc } from "./types.ts";
import { byKey } from "./util.ts";

/** The display title of `doc`, falling back to its id. */
export function titleOf(doc: Doc): string {
  const title = doc.meta.title;
  return title === undefined || title === "" ? doc.id : title;
}

/** Documents grouped by their first tag, or `untagged`. */
export function byFirstTag(docs: Doc[]): Map<string, Doc[]> {
  return byKey(docs, (doc) => doc.meta?.tags?.[0] ?? "untagged");
}
