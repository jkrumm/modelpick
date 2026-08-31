import { expect, test } from "bun:test";
import { byFirstTag, titleOf } from "../src/lookup.ts";

test("titleOf prefers the meta title", () => {
  expect(titleOf({ id: "d1", meta: { title: "Hello" } })).toBe("Hello");
});

test("titleOf falls back to the id", () => {
  expect(titleOf({ id: "d2" })).toBe("d2");
  expect(titleOf({ id: "d3", meta: {} })).toBe("d3");
  expect(titleOf({ id: "d4", meta: { title: "" } })).toBe("d4");
});

test("byFirstTag groups on the first tag", () => {
  const docs = [
    { id: "a", meta: { tags: ["news", "eu"] } },
    { id: "b", meta: { tags: ["news"] } },
    { id: "c" },
  ];
  const groups = byFirstTag(docs);
  expect([...groups.keys()]).toEqual(["news", "untagged"]);
  expect(groups.get("news")?.map((doc) => doc.id)).toEqual(["a", "b"]);
});
