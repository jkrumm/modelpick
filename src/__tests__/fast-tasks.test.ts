import { describe, it, expect } from "vitest";
import { FAST_TASKS, getFastTasks } from "../server/bench/fast-tasks.js";

function taskById(id: string) {
  const task = FAST_TASKS.find((t) => t.id === id);
  if (!task) throw new Error(`missing task ${id}`);
  return task;
}

describe("extract", () => {
  const { grade } = taskById("extract");

  it("passes a well-formed JSON object", () => {
    expect(
      grade(
        JSON.stringify({
          name: "Anna Fischer",
          order_id: "BE-48213",
          issue_category: "damaged_item",
          urgency: "high",
        }),
      ),
    ).toBe(true);
  });

  it("passes the same JSON wrapped in a ```json fence with surrounding prose", () => {
    const text = [
      "Here is the extracted data:",
      "```json",
      JSON.stringify({
        name: "Anna Fischer",
        order_id: "BE-48213",
        issue_category: "damaged_item",
        urgency: "high",
      }),
      "```",
    ].join("\n");
    expect(grade(text)).toBe(true);
  });

  it("fails when a field value is wrong", () => {
    expect(
      grade(
        JSON.stringify({
          name: "Anna Fischer",
          order_id: "BE-48213",
          issue_category: "missing_item",
          urgency: "high",
        }),
      ),
    ).toBe(false);
  });

  it("fails on unparsable text", () => {
    expect(grade("Sorry, I cannot do that.")).toBe(false);
  });
});

describe("reason", () => {
  const { grade } = taskById("reason");

  it("passes when the final integer is the expected answer", () => {
    expect(grade("Morning: 90 sold, 150 left. Afternoon: 75 sold, 75 left. Plus 45.\n120")).toBe(
      true,
    );
  });

  it("fails when the final integer is wrong", () => {
    expect(grade("After working through it, the answer is 150.")).toBe(false);
  });

  it("fails when there is no integer at all", () => {
    expect(grade("I don't know the answer.")).toBe(false);
  });
});

describe("classify", () => {
  const { grade } = taskById("classify");

  it("passes the expected label, trimmed", () => {
    expect(grade("  technical_support  \n")).toBe(true);
  });

  it("fails on a different label", () => {
    expect(grade("billing")).toBe(false);
  });

  it("fails when extra text surrounds the label", () => {
    expect(grade("The label is technical_support.")).toBe(false);
  });
});

describe("instruct", () => {
  const { grade } = taskById("instruct");

  const valid = [
    "- Keep modules small and Modell-driven.",
    "- Favor composition over inheritance.",
    "- Hide implementation details behind interfaces.",
    "- Keep coupling low between components.",
    "- Every Modell change should stay backward compatible.",
  ].join("\n");

  it("passes 5 dash-prefixed lines with 'Modell' exactly twice", () => {
    expect(grade(valid)).toBe(true);
  });

  it("fails when there are not exactly 5 lines", () => {
    const fourLines = valid.split("\n").slice(0, 4).join("\n");
    expect(grade(fourLines)).toBe(false);
  });

  it("fails when 'Modell' appears the wrong number of times", () => {
    const onlyOnce = valid.replace("Modell-driven", "focused");
    expect(grade(onlyOnce)).toBe(false);
  });

  it("fails when a line does not start with '- '", () => {
    const broken = valid.replace("- Keep modules", "Keep modules");
    expect(grade(broken)).toBe(false);
  });
});

describe("longform", () => {
  const { grade } = taskById("longform");
  const words = (n: number): string => Array.from({ length: n }, () => "word").join(" ");

  it("passes a ~1200 word response", () => {
    expect(grade(words(1200))).toBe(true);
  });

  it("fails a response that is too short", () => {
    expect(grade(words(400))).toBe(false);
  });

  it("fails a response that is too long", () => {
    expect(grade(words(2000))).toBe(false);
  });
});

describe("getFastTasks", () => {
  it("returns the full registry with no ids", () => {
    expect(getFastTasks().map((t) => t.id)).toEqual(FAST_TASKS.map((t) => t.id));
  });

  it("selects a subset by id", () => {
    expect(getFastTasks(["classify", "reason"]).map((t) => t.id)).toEqual(["classify", "reason"]);
  });

  it("throws on an unknown id", () => {
    expect(() => getFastTasks(["nope"])).toThrow(/unknown task id/);
  });
});
