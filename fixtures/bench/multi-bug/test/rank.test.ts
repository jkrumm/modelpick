import { expect, test } from "bun:test";
import { rank, topN } from "../src/rank.ts";

const names = (entries: Array<{ name: string }>): string[] => entries.map((e) => e.name);

test("rank orders by score descending", () => {
  const entries = [
    { name: "bob", score: 7 },
    { name: "ada", score: 12 },
    { name: "cid", score: 3 },
  ];
  expect(names(rank(entries))).toEqual(["ada", "bob", "cid"]);
});

test("rank breaks ties by name ascending", () => {
  const entries = [
    { name: "zoe", score: 10 },
    { name: "ada", score: 10 },
    { name: "mel", score: 10 },
    { name: "bob", score: 7 },
  ];
  expect(names(rank(entries))).toEqual(["ada", "mel", "zoe", "bob"]);
});

test("rank leaves the input untouched", () => {
  const entries = [
    { name: "bob", score: 7 },
    { name: "ada", score: 12 },
  ];
  rank(entries);
  expect(names(entries)).toEqual(["bob", "ada"]);
});

test("topN takes the highest scores", () => {
  const entries = [
    { name: "bob", score: 7 },
    { name: "ada", score: 12 },
    { name: "cid", score: 3 },
  ];
  expect(names(topN(entries, 2))).toEqual(["ada", "bob"]);
});
