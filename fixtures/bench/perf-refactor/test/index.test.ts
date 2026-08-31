import { expect, test } from "bun:test";
import { findPairs, groupAnagrams } from "../src/index.ts";

test("findPairs returns every matching index pair", () => {
  expect(findPairs([1, 2, 3, 4], 5)).toEqual([
    [0, 3],
    [1, 2],
  ]);
  expect(findPairs([2, 2, 2], 4)).toEqual([
    [0, 1],
    [0, 2],
    [1, 2],
  ]);
  expect(findPairs([1, 2, 3], 99)).toEqual([]);
  expect(findPairs([], 0)).toEqual([]);
});

test("findPairs orders pairs by i then j", () => {
  expect(findPairs([5, 1, 5, 1, 5], 6)).toEqual([
    [0, 1],
    [0, 3],
    [1, 2],
    [1, 4],
    [2, 3],
    [3, 4],
  ]);
});

test("groupAnagrams groups by letters", () => {
  expect(groupAnagrams(["eat", "tea", "tan", "ate", "nat", "bat"])).toEqual([
    ["eat", "tea", "ate"],
    ["tan", "nat"],
    ["bat"],
  ]);
  expect(groupAnagrams([])).toEqual([]);
});

test("groupAnagrams keeps first-occurrence and input order", () => {
  expect(groupAnagrams(["ba", "ab", "cd", "dc", "ba"])).toEqual([
    ["ba", "ab", "ba"],
    ["cd", "dc"],
  ]);
});
