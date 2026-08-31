import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/expr.ts";

/** Asserts a SyntaxError whose message carries the given 0-based offset. */
function expectSyntaxError(src: string, offset: number): void {
  let caught: unknown = null;
  try {
    evaluate(src);
  } catch (error) {
    caught = error;
  }
  expect(caught, `evaluate(${JSON.stringify(src)}) should have thrown`).toBeInstanceOf(SyntaxError);
  const message = String((caught as Error).message);
  expect(message, `offset for ${JSON.stringify(src)}`).toMatch(
    new RegExp(`(^|\\D)at ${offset}(?![0-9])`),
  );
}

describe("precedence and associativity", () => {
  test("multiplicative binds tighter than additive", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("2 * 3 + 4")).toBe(10);
    expect(evaluate("1 + 2 * 3 - 4 / 2")).toBe(5);
  });

  test("additive is left associative", () => {
    expect(evaluate("10 - 3 - 2")).toBe(5);
    expect(evaluate("2 + 3 - 4 + 5")).toBe(6);
  });

  test("multiplicative is left associative", () => {
    expect(evaluate("100 / 10 / 2")).toBe(5);
    expect(evaluate("20 % 7 % 4")).toBe(2);
    expect(evaluate("2 * 3 % 4")).toBe(2);
  });
});

describe("unary minus and nesting", () => {
  test("negates a literal", () => {
    expect(evaluate("-5")).toBe(-5);
    expect(evaluate("2 - -3")).toBe(5);
  });

  test("stacks", () => {
    expect(evaluate("--5")).toBe(5);
    expect(evaluate("-(-(-3))")).toBe(-3);
  });

  test("applies to a parenthesised group", () => {
    expect(evaluate("-(2 + 3)")).toBe(-5);
    expect(evaluate("-(2 + 3) * 2 % 7")).toBe(-3);
  });

  test("combines with multiplication", () => {
    expect(evaluate("-2 * -3")).toBe(6);
    expect(evaluate("-2 % 3")).toBe(-2);
  });

  test("handles deep nesting", () => {
    expect(evaluate("(1 + (2 * (3 + 4)))")).toBe(15);
    expect(evaluate("((((7))))")).toBe(7);
  });
});

describe("decimals and whitespace", () => {
  test("parses decimal literals", () => {
    expect(evaluate("1.5 + 2.5")).toBe(4);
    expect(evaluate("0.5")).toBe(0.5);
    expect(evaluate("2.5 * 4")).toBe(10);
    expect(evaluate("10.0 / 4")).toBe(2.5);
  });

  test("keeps float semantics", () => {
    expect(evaluate("0.1 + 0.2")).toBeCloseTo(0.30000000000000004, 15);
    expect(evaluate("1.25 + 1.25 * 2")).toBe(3.75);
  });

  test("ignores arbitrary whitespace between tokens", () => {
    expect(evaluate("  7   ")).toBe(7);
    expect(evaluate("\t3\t+\t4\t")).toBe(7);
    expect(evaluate("   (  1   +2 )*   3 ")).toBe(9);
  });
});

describe("division and modulo", () => {
  test("divides as floating point", () => {
    expect(evaluate("7 / 2")).toBe(3.5);
    expect(evaluate("9 / 3 / 3")).toBe(1);
  });

  test("division by zero follows IEEE-754", () => {
    expect(evaluate("1 / 0")).toBe(Infinity);
    expect(evaluate("-1 / 0")).toBe(-Infinity);
    expect(Number.isNaN(evaluate("0 / 0"))).toBe(true);
  });

  test("modulo keeps the sign of the dividend", () => {
    expect(evaluate("-7 % 3")).toBe(-1);
    expect(evaluate("7 % -3")).toBe(1);
  });

  test("modulo by zero is NaN", () => {
    expect(Number.isNaN(evaluate("5 % 0"))).toBe(true);
  });
});

describe("error offsets", () => {
  test("reports the end of input", () => {
    expectSyntaxError("", 0);
    expectSyntaxError("   ", 3);
    expectSyntaxError("1 +", 3);
    expectSyntaxError("-", 1);
    expectSyntaxError("(1 + 2", 6);
  });

  test("reports an operator where a value was expected", () => {
    expectSyntaxError("1 + * 2", 4);
    expectSyntaxError("* 3", 0);
    expectSyntaxError("()", 1);
    expectSyntaxError("(())", 2);
  });

  test("reports trailing input", () => {
    expectSyntaxError("1 2", 2);
    expectSyntaxError("1 $ 2", 2);
    expectSyntaxError("3 + 4)", 5);
    expectSyntaxError("(1))", 3);
    expectSyntaxError("1 + 2 @", 6);
  });

  test("rejects a literal with no leading digit", () => {
    expectSyntaxError(".5", 0);
  });
});
