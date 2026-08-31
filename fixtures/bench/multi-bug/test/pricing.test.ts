import { expect, test } from "bun:test";
import { discountRatio, tierFor } from "../src/pricing.ts";

test("tierFor covers bronze and silver", () => {
  expect(tierFor(0)).toBe("bronze");
  expect(tierFor(99_999)).toBe("bronze");
  expect(tierFor(100_000)).toBe("silver");
  expect(tierFor(499_999)).toBe("silver");
});

test("tierFor covers gold", () => {
  expect(tierFor(500_000)).toBe("gold");
  expect(tierFor(1_999_999)).toBe("gold");
});

test("tierFor covers platinum", () => {
  expect(tierFor(2_000_000)).toBe("platinum");
  expect(tierFor(9_000_000)).toBe("platinum");
});

test("discountRatio grows with the tier", () => {
  expect(discountRatio("bronze")).toBe(0);
  expect(discountRatio("silver")).toBe(0.05);
  expect(discountRatio("gold")).toBe(0.1);
  expect(discountRatio("platinum")).toBe(0.15);
});
