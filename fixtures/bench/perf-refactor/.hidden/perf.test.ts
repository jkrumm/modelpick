import { describe, expect, test } from "bun:test";
import { findPairs, groupAnagrams } from "../src/index.ts";

const VALUE_COUNT = 500_000;
const VALUE_RANGE = 10_000_000;
const TARGET = 10_000_000;
const WORD_COUNT = 150_000;
const GROUP_COUNT = 4_000;
const BUDGET_MS = 10_000;

const A0 = "abcdefghijklmnop";
const A1 = "qrstuvwxyzABCDEF";
const A2 = "GHIJKLMNOPQRSTUV";
const PAD = "0123";

/** A deterministic linear congruential generator — no Math.random anywhere. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeValues(count: number): number[] {
  const rnd = lcg(20260831);
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = Math.floor(rnd() * VALUE_RANGE);
  return out;
}

/** A 7-letter word whose letter multiset is unique to `k` (k < 4096). */
function baseWord(k: number): string {
  return A0[k % 16]! + A1[(k >> 4) % 16]! + A2[(k >> 8) % 16]! + PAD;
}

function makeWords(count: number, groups: number): string[] {
  const rnd = lcg(77_777);
  const out = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    const chars = [...baseWord(i % groups)];
    for (let c = chars.length - 1; c > 0; c--) {
      const swap = Math.floor(rnd() * (c + 1));
      const tmp = chars[c]!;
      chars[c] = chars[swap]!;
      chars[swap] = tmp;
    }
    out[i] = chars.join("");
  }
  return out;
}

function referencePairs(values: number[], target: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (values[i]! + values[j]! === target) pairs.push([i, j]);
    }
  }
  return pairs;
}

function referenceGroups(words: string[]): string[][] {
  const bySignature = new Map<string, string[]>();
  const groups: string[][] = [];
  for (const word of words) {
    const key = [...word].sort().join("");
    const existing = bySignature.get(key);
    if (existing) {
      existing.push(word);
      continue;
    }
    const created = [word];
    bySignature.set(key, created);
    groups.push(created);
  }
  return groups;
}

describe("correctness", () => {
  test("findPairs matches the documented contract", () => {
    expect(findPairs([1, 2, 3, 4], 5)).toEqual([
      [0, 3],
      [1, 2],
    ]);
    expect(findPairs([2, 2, 2, 2], 4)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
    expect(findPairs([], 0)).toEqual([]);
    expect(findPairs([5], 10)).toEqual([]);
    expect(findPairs([1, 2, 3], 99)).toEqual([]);
  });

  test("findPairs handles zero and negative values", () => {
    expect(findPairs([0, 0], 0)).toEqual([[0, 1]]);
    expect(findPairs([-3, 3, 0, 3], 0)).toEqual([
      [0, 1],
      [0, 3],
    ]);
  });

  test("findPairs agrees with a brute-force reference", () => {
    const values = makeValues(2_000).map((value) => value % 500);
    const expected = referencePairs(values, 400);
    const actual = findPairs(values, 400);
    expect(actual.length).toBe(expected.length);
    expect(actual).toEqual(expected);
  });

  test("groupAnagrams matches the documented contract", () => {
    expect(groupAnagrams(["eat", "tea", "tan", "ate", "nat", "bat"])).toEqual([
      ["eat", "tea", "ate"],
      ["tan", "nat"],
      ["bat"],
    ]);
    expect(groupAnagrams([])).toEqual([]);
    expect(groupAnagrams(["solo"])).toEqual([["solo"]]);
    expect(groupAnagrams(["ba", "ab", "cd", "dc", "ba"])).toEqual([
      ["ba", "ab", "ba"],
      ["cd", "dc"],
    ]);
  });

  test("groupAnagrams is case sensitive and keeps duplicates", () => {
    expect(groupAnagrams(["Ab", "ab", "bA", "ba"])).toEqual([
      ["Ab", "bA"],
      ["ab", "ba"],
    ]);
  });

  test("groupAnagrams agrees with a reference implementation", () => {
    const words = makeWords(2_000, 300);
    expect(groupAnagrams(words)).toEqual(referenceGroups(words));
  });
});

describe("scale", () => {
  test(
    "findPairs handles the full catalogue",
    () => {
      const values = makeValues(VALUE_COUNT);
      const started = performance.now();
      const pairs = findPairs(values, TARGET);
      const elapsed = performance.now() - started;

      expect(pairs.length).toBe(12_692);
      expect(pairs[0]).toEqual([34, 331_649]);
      expect(pairs.at(-1)).toEqual([491_128, 492_498]);
      for (let index = 1; index < pairs.length; index++) {
        const previous = pairs[index - 1]!;
        const current = pairs[index]!;
        const ordered =
          previous[0] < current[0] || (previous[0] === current[0] && previous[1] < current[1]);
        expect(ordered).toBe(true);
      }
      expect(elapsed).toBeLessThan(BUDGET_MS);
    },
    120_000,
  );

  test(
    "groupAnagrams handles the full catalogue",
    () => {
      const words = makeWords(WORD_COUNT, GROUP_COUNT);
      const started = performance.now();
      const groups = groupAnagrams(words);
      const elapsed = performance.now() - started;

      expect(groups.length).toBe(GROUP_COUNT);
      expect(groups.reduce((total, group) => total + group.length, 0)).toBe(WORD_COUNT);
      expect(Math.max(...groups.map((group) => group.length))).toBe(38);
      expect(groups[0]?.[0]).toBe(words[0]);
      expect(groups[GROUP_COUNT - 1]?.[0]).toBe(words[GROUP_COUNT - 1]);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    },
    120_000,
  );
});
