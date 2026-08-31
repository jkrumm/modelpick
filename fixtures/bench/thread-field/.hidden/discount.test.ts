import { expect, test } from "bun:test";
import { toOrder } from "../src/mapper.ts";
import { orderLine } from "../src/report.ts";

test("toOrder carries discount_cents across", () => {
  const order = toOrder({
    id: "B-7",
    customer_name: "Bob",
    total_cents: 5000,
    discount_cents: 250,
  });
  expect(order.discountCents).toBe(250);
});

test("toOrder defaults a missing or null discount to zero", () => {
  expect(toOrder({ id: "C-1", customer_name: "Cid", total_cents: 100 }).discountCents).toBe(0);
  expect(
    toOrder({ id: "C-2", customer_name: "Cid", total_cents: 100, discount_cents: null })
      .discountCents,
  ).toBe(0);
});

test("orderLine appends the discount when there is one", () => {
  const order = toOrder({
    id: "B-7",
    customer_name: "Bob",
    total_cents: 5000,
    discount_cents: 250,
  });
  expect(orderLine(order)).toBe("B-7 | Bob | 50,00 € (discount 2,50 €)");
});

test("orderLine omits the discount when it is zero", () => {
  const order = toOrder({ id: "A-1", customer_name: "Ada", total_cents: 1999 });
  expect(orderLine(order)).toBe("A-1 | Ada | 19,99 €");
});
