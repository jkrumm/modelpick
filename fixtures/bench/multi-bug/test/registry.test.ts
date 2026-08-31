import { expect, test } from "bun:test";
import { allTags, makePlugin } from "../src/registry.ts";

test("makePlugin does not mutate the caller's array", () => {
  const tags = ["core"];
  const plugin = makePlugin("gamma", tags);
  expect(plugin.tags).toEqual(["core", "plugin:gamma"]);
  expect(tags).toEqual(["core"]);
});

test("makePlugin defaults to just the self tag, on every call", () => {
  expect(makePlugin("alpha").tags).toEqual(["plugin:alpha"]);
  expect(makePlugin("beta").tags).toEqual(["plugin:beta"]);
});

test("allTags collects distinct tags in first-seen order", () => {
  const plugins = [
    { name: "a", tags: ["core", "plugin:a"] },
    { name: "b", tags: ["plugin:b", "core"] },
  ];
  expect(allTags(plugins)).toEqual(["core", "plugin:a", "plugin:b"]);
});
