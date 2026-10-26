import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MY_STACK, STACK } from "../stack";
import { readStackHash, renderStack, stackSourceHash } from "../stack-render";

const committed = readFileSync(
  new URL("../../STACK.md", import.meta.url),
  "utf8",
);

describe("STACK.md", () => {
  it("was rendered from the current src/stack.ts and deployments.ts (run `make stack`)", () => {
    expect(readStackHash(committed)).toBe(stackSourceHash());
  });

  it("renders one row per job, with n/a for missing prices and drift", () => {
    const md = renderStack({ prices: new Map(), recommended: new Map() });
    const rows = md
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| Job"));
    expect(rows).toHaveLength(STACK.length);
    expect(rows[0]).toContain("n/a / n/a");
  });

  it("flags drift only when the recommendation differs", () => {
    const first = STACK[0]!;
    const same = renderStack({
      prices: new Map(),
      recommended: new Map([[first.category, first.model_id]]),
    });
    const other = renderStack({
      prices: new Map(),
      recommended: new Map([[first.category, "other-model"]]),
    });
    expect(same).not.toContain("review: other-model");
    expect(other).toContain("review: other-model");
  });
});

describe("MY_STACK", () => {
  it("has one stack_choice row per category", () => {
    const cats = MY_STACK.map((r) => r.category);
    expect(new Set(cats).size).toBe(cats.length);
  });
});
