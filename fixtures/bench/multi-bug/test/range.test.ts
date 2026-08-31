import { expect, test } from "bun:test";
import { clampIndex, windows } from "../src/range.ts";

test("clampIndex leaves a valid index alone", () => {
  expect(clampIndex(0, 5)).toBe(0);
  expect(clampIndex(3, 5)).toBe(3);
});

test("clampIndex clamps a negative index to the front", () => {
  expect(clampIndex(-1, 5)).toBe(0);
  expect(clampIndex(-99, 5)).toBe(0);
});

test("clampIndex clamps at and beyond the end", () => {
  expect(clampIndex(4, 5)).toBe(4);
  expect(clampIndex(5, 5)).toBe(4);
  expect(clampIndex(9, 5)).toBe(4);
});

test("clampIndex reports -1 for an empty array", () => {
  expect(clampIndex(0, 0)).toBe(-1);
});

test("windows walks the input in steps", () => {
  expect(windows([1, 2, 3, 4, 5], 2, 1)).toEqual([
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
  ]);
  expect(windows([1, 2, 3, 4], 2, 2)).toEqual([
    [1, 2],
    [3, 4],
  ]);
  expect(windows([1, 2], 3, 1)).toEqual([]);
});
