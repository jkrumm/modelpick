import { expect, test } from "bun:test";
import { isLastPage, pageCount, pageSlice } from "../src/pagination.ts";

const items = ["a", "b", "c", "d", "e", "f", "g"];

test("pageCount rounds up", () => {
  expect(pageCount(7, 3)).toBe(3);
  expect(pageCount(6, 3)).toBe(2);
});

test("pageSlice returns exactly pageSize items", () => {
  expect(pageSlice(items, 1, 3)).toEqual(["a", "b", "c"]);
  expect(pageSlice(items, 2, 3)).toEqual(["d", "e", "f"]);
});

test("pageSlice returns the remainder on the last page", () => {
  expect(pageSlice(items, 3, 3)).toEqual(["g"]);
});

test("isLastPage knows the final page", () => {
  expect(isLastPage(7, 3, 3)).toBe(true);
  expect(isLastPage(7, 2, 3)).toBe(false);
});
