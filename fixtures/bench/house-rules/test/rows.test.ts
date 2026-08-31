import { expect, test } from "bun:test";
import { columnsOf, isBlank, missingColumns } from "../src/rows.ts";

test("isBlank treats null, undefined and empty string as blank", () => {
  expect(isBlank(null)).toBe(true);
  expect(isBlank(undefined)).toBe(true);
  expect(isBlank("")).toBe(true);
  expect(isBlank(0)).toBe(false);
  expect(isBlank("a")).toBe(false);
});

test("missingColumns lists unfilled required columns", () => {
  expect(missingColumns({ id: "1", name: "Ada", email: "ada@example.com" })).toEqual([]);
  expect(missingColumns({ id: "1", email: null })).toEqual(["name", "email"]);
});

test("columnsOf collects columns in first-seen order", () => {
  expect(columnsOf([{ id: "1" }, { name: "Ada", id: "2" }])).toEqual(["id", "name"]);
  expect(columnsOf([])).toEqual([]);
});
