import { expect, test } from "bun:test";
import { formatEuro, roundToCents, sumEuro } from "../src/money.ts";

test("roundToCents rounds up at half a cent and above", () => {
  expect(roundToCents(1.006)).toBe(1.01);
  expect(roundToCents(2.128)).toBe(2.13);
});

test("roundToCents leaves exact cent amounts alone", () => {
  expect(roundToCents(1.01)).toBe(1.01);
  expect(roundToCents(0)).toBe(0);
});

test("formatEuro renders two decimals", () => {
  expect(formatEuro(1.5)).toBe("1.50 EUR");
});

test("sumEuro adds and rounds", () => {
  expect(sumEuro([0.1, 0.2])).toBe(0.3);
});
