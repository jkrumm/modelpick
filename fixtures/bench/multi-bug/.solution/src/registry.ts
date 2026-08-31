import type { Plugin } from "./types.ts";
import { unique } from "./util.ts";

const DEFAULT_TAGS: readonly string[] = [];

/** Builds a registered plugin. Its own `plugin:<name>` tag is always appended. */
export function makePlugin(name: string, tags: readonly string[] = DEFAULT_TAGS): Plugin {
  return { name, tags: unique([...tags, `plugin:${name}`]) };
}

/** Every distinct tag across `plugins`, in first-seen order. */
export function allTags(plugins: Plugin[]): string[] {
  return unique(plugins.flatMap((plugin) => plugin.tags));
}
