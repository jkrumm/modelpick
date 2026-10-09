import { describe, it, expect } from "vitest";
import {
  DECISION_TASKS,
  getDecisionTasks,
  gradeAnswer,
  gradeCase,
  type DecisionTask,
} from "../server/bench/decision-tasks.js";
import type { DecisionQuestion } from "../server/iu/decision-client.js";

const CHOICE: DecisionQuestion = {
  type: "choice",
  instructions: "x",
  criteria: { a: "A", b: "B", c: "C" },
};
const BOOL: DecisionQuestion = { type: "boolean", instructions: "x" };
const SCORE: DecisionQuestion = {
  type: "score",
  instructions: "x",
  levels: [
    { label: "lo", description: "l" },
    { label: "hi", description: "h" },
  ],
};

const score = (s: number) =>
  ({ type: "score", score: s, confidence: null, probabilities: null }) as const;

function taskById(id: string): DecisionTask {
  const task = DECISION_TASKS.find((t) => t.id === id);
  if (!task) throw new Error(`missing task ${id}`);
  return task;
}

describe("gradeAnswer — boolean", () => {
  const expectYes = { type: "boolean", value: true } as const;

  it("is correct at p >= 0.5 for an expected yes, and scores the squared error", () => {
    const g = gradeAnswer("q", BOOL, expectYes, { type: "boolean", probability: 0.9 });
    expect(g.outcome).toBe("correct");
    expect(g.brier).toBeCloseTo(0.01);
    expect(g.expectedProbability).toBe(0.9);
  });

  it("is wrong below 0.5 and reports the probability on the expected outcome", () => {
    const g = gradeAnswer("q", BOOL, expectYes, { type: "boolean", probability: 0.2 });
    expect(g.outcome).toBe("wrong");
    expect(g.brier).toBeCloseTo(0.64);
  });

  it("flips the target for an expected no", () => {
    const g = gradeAnswer(
      "q",
      BOOL,
      { type: "boolean", value: false },
      {
        type: "boolean",
        probability: 0.1,
      },
    );
    expect(g.outcome).toBe("correct");
    expect(g.expectedProbability).toBeCloseTo(0.9);
    expect(g.brier).toBeCloseTo(0.01);
  });
});

describe("gradeAnswer — choice", () => {
  const expectA = { type: "choice", value: "a" } as const;

  it("scores multi-class Brier over every option, a missing option counting as 0", () => {
    const g = gradeAnswer("q", CHOICE, expectA, {
      type: "choice",
      choice: "a",
      confidence: 0.8,
      probabilities: { a: 0.8, b: 0.2 },
    });
    expect(g.outcome).toBe("correct");
    // (0.8-1)^2 + 0.2^2 + 0^2
    expect(g.brier).toBeCloseTo(0.08);
    expect(g.expectedProbability).toBe(0.8);
  });

  it("is wrong when the chosen option differs", () => {
    const g = gradeAnswer("q", CHOICE, expectA, {
      type: "choice",
      choice: "b",
      confidence: 0.9,
      probabilities: { a: 0.1, b: 0.9 },
    });
    expect(g.outcome).toBe("wrong");
    expect(g.expectedProbability).toBe(0.1);
  });

  it("has no Brier score when the model returned no probabilities", () => {
    const g = gradeAnswer("q", CHOICE, expectA, {
      type: "choice",
      choice: "a",
      confidence: null,
      probabilities: {},
    });
    expect(g.outcome).toBe("correct");
    expect(g.brier).toBeNull();
  });
});

describe("gradeAnswer — score", () => {
  const expect1 = { type: "score", value: 1, tolerance: 0.5 } as const;

  it("accepts a score within tolerance, inclusive", () => {
    expect(gradeAnswer("q", SCORE, expect1, score(1.5)).outcome).toBe("correct");
    expect(gradeAnswer("q", SCORE, expect1, score(0.5)).outcome).toBe("correct");
  });

  it("rejects a score outside tolerance", () => {
    expect(gradeAnswer("q", SCORE, expect1, score(1.6)).outcome).toBe("wrong");
  });
});

describe("gradeAnswer — non-answers", () => {
  const expectYes = { type: "boolean", value: true } as const;

  it("grades a refusal as refused, not wrong", () => {
    const g = gradeAnswer("q", BOOL, expectYes, { type: "refusal", message: "no" });
    expect(g.outcome).toBe("refused");
  });

  it("grades an answer of the wrong type as wrong instead of throwing", () => {
    const g = gradeAnswer("q", BOOL, expectYes, {
      type: "choice",
      choice: "a",
      confidence: 1,
      probabilities: {},
    });
    expect(g.outcome).toBe("wrong");
  });

  it("grades a missing answer as wrong", () => {
    expect(gradeAnswer("q", BOOL, expectYes, undefined).outcome).toBe("wrong");
  });
});

describe("gradeCase", () => {
  it("grades every expected question of a case", () => {
    const task = taskById("email-triage");
    const testCase = task.cases[0];
    if (!testCase) throw new Error("no case");
    const grades = gradeCase(task, testCase, {
      spam: { type: "boolean", probability: 0.05 },
      category: {
        type: "choice",
        choice: "inquiry",
        confidence: 0.9,
        probabilities: { inquiry: 0.9 },
      },
    });
    expect(grades.map((g) => [g.question, g.outcome])).toEqual([
      ["spam", "correct"],
      ["category", "correct"],
    ]);
  });
});

describe("the registry", () => {
  it("has unique task ids and unique case ids within each task", () => {
    expect(new Set(DECISION_TASKS.map((t) => t.id)).size).toBe(DECISION_TASKS.length);
    for (const task of DECISION_TASKS) {
      expect(new Set(task.cases.map((c) => c.id)).size, task.id).toBe(task.cases.length);
    }
  });

  it("only expects questions the task asks, with choice values drawn from the criteria", () => {
    for (const task of DECISION_TASKS) {
      for (const testCase of task.cases) {
        for (const [name, expected] of Object.entries(testCase.expected)) {
          const def = task.questions[name];
          expect(def, `${task.id}/${testCase.id}/${name}`).toBeDefined();
          expect(def?.type).toBe(expected.type);
          if (expected.type === "choice" && def?.type === "choice") {
            expect(Object.keys(def.criteria), `${task.id}/${testCase.id}`).toContain(
              expected.value,
            );
          }
          if (expected.type === "score" && def?.type === "score") {
            expect(expected.value).toBeGreaterThanOrEqual(0);
            expect(expected.value).toBeLessThanOrEqual(def.levels.length - 1);
          }
        }
      }
    }
  });

  it("covers every verdict in the contact-form suite with the 14 recorded cases first", () => {
    const task = taskById("contact-form-verdict");
    expect(task.cases.length).toBeGreaterThanOrEqual(24);
    const verdicts = task.cases
      .slice(0, 14)
      .map((c) => (c.expected["verdict"] as { value: string }).value);
    expect(verdicts.filter((v) => v === "legit")).toHaveLength(7);
    expect(verdicts.filter((v) => v === "marketing")).toHaveLength(4);
    expect(verdicts.filter((v) => v === "spam")).toHaveLength(3);
  });

  it("exercises all three answer types", () => {
    const types = new Set(
      DECISION_TASKS.flatMap((t) => Object.values(t.questions).map((q) => q.type)),
    );
    expect(types).toEqual(new Set(["choice", "boolean", "score"]));
  });

  it("selects tasks by id and rejects an unknown id", () => {
    expect(getDecisionTasks(["urgency-score"]).map((t) => t.id)).toEqual(["urgency-score"]);
    expect(getDecisionTasks()).toHaveLength(DECISION_TASKS.length);
    expect(() => getDecisionTasks(["nope"])).toThrow(/unknown task/);
  });
});
