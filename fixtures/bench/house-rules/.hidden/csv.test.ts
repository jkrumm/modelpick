import { expect, test } from "bun:test";
import { toCsv } from "../src/csv.ts";

test("writes the header even with no rows", () => {
  expect(toCsv([])).toBe("id,name,email");
});

test("writes one line per row in required-column order", () => {
  const csv = toCsv([
    { id: "1", name: "Ada", email: "ada@example.com" },
    { id: "2", name: "Bob", email: "bob@example.com" },
  ]);
  expect(csv).toBe("id,name,email\n1,Ada,ada@example.com\n2,Bob,bob@example.com");
});

test("renders numbers and leaves missing or null cells empty", () => {
  const csv = toCsv([{ id: 7, email: null }]);
  expect(csv).toBe("id,name,email\n7,,");
});

test("ignores columns that are not required", () => {
  const csv = toCsv([{ id: "1", name: "Ada", email: "ada@example.com", note: "extra" }]);
  expect(csv).toBe("id,name,email\n1,Ada,ada@example.com");
});

test("quotes only fields containing a comma, a quote or a newline", () => {
  expect(toCsv([{ id: "1", name: "Doe, Ada", email: "a@example.com" }])).toBe(
    'id,name,email\n1,"Doe, Ada",a@example.com',
  );
  expect(toCsv([{ id: "1", name: 'Ada "Countess"', email: "a@example.com" }])).toBe(
    'id,name,email\n1,"Ada ""Countess""",a@example.com',
  );
  expect(toCsv([{ id: "1", name: "Ada\nLovelace", email: "a@example.com" }])).toBe(
    'id,name,email\n1,"Ada\nLovelace",a@example.com',
  );
});
