import { expect, test } from "bun:test";
import { toOrder } from "../src/mapper.ts";
import { formatCents, orderLine } from "../src/report.ts";

test("formatCents renders cents as euros", () => {
  expect(formatCents(1999)).toBe("19,99 €");
  expect(formatCents(500)).toBe("5,00 €");
});

test("orderLine renders id, customer and total", () => {
  const order = toOrder({ id: "A-1", customer_name: "Ada", total_cents: 1999 });
  expect(orderLine(order)).toBe("A-1 | Ada | 19,99 €");
});
