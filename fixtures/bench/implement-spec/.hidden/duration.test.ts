import { expect, test } from "bun:test";
import { parseDuration } from "../src/duration.ts";

test("parses every unit", () => {
  expect(parseDuration("250ms")).toBe(250);
  expect(parseDuration("30s")).toBe(30_000);
  expect(parseDuration("5m")).toBe(300_000);
  expect(parseDuration("2h")).toBe(7_200_000);
  expect(parseDuration("1d")).toBe(86_400_000);
});

test("parses decimal amounts", () => {
  expect(parseDuration("1.5h")).toBe(5_400_000);
  expect(parseDuration("0.5s")).toBe(500);
  expect(parseDuration("2.5d")).toBe(216_000_000);
});

test("ignores surrounding whitespace", () => {
  expect(parseDuration("  10s  ")).toBe(10_000);
  expect(parseDuration("\t1.5h\n")).toBe(5_400_000);
});

test("treats the unit case-insensitively", () => {
  expect(parseDuration("30S")).toBe(30_000);
  expect(parseDuration("250MS")).toBe(250);
  expect(parseDuration("2H")).toBe(7_200_000);
  expect(parseDuration("1D")).toBe(86_400_000);
});

test("distinguishes minutes from milliseconds", () => {
  expect(parseDuration("1m")).toBe(60_000);
  expect(parseDuration("1ms")).toBe(1);
});

test("throws a TypeError for invalid input", () => {
  for (const bad of ["", "   ", "10", "s", "10x", "-5s", "NaN", "abc", "1.5", "10 s"]) {
    expect(() => parseDuration(bad)).toThrow(TypeError);
  }
});
