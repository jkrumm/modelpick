import { describe, it, expect } from "vitest";
import {
  aggregateCell,
  blindAssign,
  classifyGeneration,
  isEligibleJudge,
  labOf,
  leaderboard,
  lintText,
  parseJudgeJson,
  scoreCells,
  seededShuffle,
  sentencesOf,
  type GenerationRecord,
  type JudgeRecord,
} from "../server/bench/writing-metrics.js";
import { buildBlind, buildKey, buildReport } from "../server/bench/writing-report.js";
import { RUBRIC, WRITING_TASKS, candidatePrompt, getWritingTasks, judgePrompt } from "../server/bench/writing-tasks.js";

const CRITERIA = RUBRIC.map((c) => c.id);

describe("lint: banned lexical (English)", () => {
  it("counts voice.md banned words with inflections", () => {
    const lint = lintText("We leverage a robust, seamless stack. It delves into the realm of the vibrant.", "en");
    expect(lint.bannedLexical.hits).toEqual(["leverage", "robust", "seamless", "delves", "realm", "vibrant"]);
    expect(lint.bannedLexical.count).toBe(6);
  });

  it("does not match inside longer words", () => {
    expect(lintText("The unlockable robustly-named thing is fine.", "en").bannedLexical.count).toBe(0);
  });

  it("is clean on plain prose", () => {
    expect(lintText("The build takes 12 seconds. We use Bun.", "en").bannedLexical.count).toBe(0);
  });

  it("is not applied to German text, English tech terms stay unflagged", () => {
    const lint = lintText("Das Deployment ist robust, der Cache nutzt leverage-Patterns im Realm.", "de");
    expect(lint.bannedLexical).toEqual({ count: 0, hits: [] });
  });
});

describe("lint: negative parallelism", () => {
  it("catches 'it's not X, it's Y'", () => {
    expect(lintText("It's not a tool, it's a platform.", "en").negativeParallelism).toBe(1);
  });

  it("catches the two-sentence form and the curly apostrophe", () => {
    expect(lintText("It’s not a bug. It’s a feature.", "en").negativeParallelism).toBe(1);
  });

  it("catches 'isn't just X, but Y' and 'not only … but also'", () => {
    expect(lintText("This isn't just a cache, but a database.", "en").negativeParallelism).toBe(1);
    expect(lintText("It is not only fast but also cheap.", "en").negativeParallelism).toBe(1);
  });

  it("counts one construction once even when two patterns overlap", () => {
    expect(lintText("It's not only fast, it's also cheap.", "en").negativeParallelism).toBe(1);
  });

  it("does not flag a plain negation", () => {
    expect(lintText("The cache is not warm. It takes 12 seconds on a cold start.", "en").negativeParallelism).toBe(0);
  });

  it("catches 'nicht nur … sondern auch'", () => {
    expect(lintText("Das ist nicht nur schnell, sondern auch sicher.", "de").negativeParallelism).toBe(1);
  });

  it("catches 'nicht X, sondern Y' and 'kein X, sondern Y'", () => {
    expect(lintText("Es geht nicht um Tempo, sondern um Korruption.", "de").negativeParallelism).toBe(1);
    expect(lintText("Das ist kein Docker-Container, sondern ein LaunchAgent.", "de").negativeParallelism).toBe(1);
  });

  it("does not flag a plain German negation", () => {
    expect(lintText("Der Container startet nicht. Die Datei ist beschädigt.", "de").negativeParallelism).toBe(0);
  });
});

describe("lint: German Nominalstil", () => {
  it("counts -ung/-heit/-keit nouns per 100 words", () => {
    const lint = lintText("Die Durchführung der Überprüfung erfordert Sicherheit und Zuverlässigkeit.", "de");
    expect(lint.nominalCount).toBe(4);
    expect(lint.words).toBe(8);
    expect(lint.nominalPer100).toBe(50);
  });

  it("does not flag English tech terms inside German text", () => {
    const lint = lintText(
      "Das Deployment läuft als LaunchAgent. Der Cache sitzt im Memory, die Pipeline nutzt Docker, Bind Mounts und das Logging.",
      "de",
    );
    expect(lint.nominalCount).toBe(0);
    expect(lint.nominalPer100).toBe(0);
    expect(lint.bannedLexical.count).toBe(0);
  });

  it("matches inflected forms", () => {
    expect(lintText("Die Meldungen und die Möglichkeiten.", "de").nominalCount).toBe(2);
  });

  it("is null for English", () => {
    const lint = lintText("The deployment runs.", "en");
    expect(lint.nominalCount).toBeNull();
    expect(lint.nominalPer100).toBeNull();
  });
});

describe("lint: long sentences", () => {
  const long = `${"word ".repeat(31).trim()}.`;

  it("flags sentences over 30 words", () => {
    expect(lintText(`${long} Short one.`, "en").longSentences).toBe(1);
  });

  it("does not flag exactly 30 words", () => {
    expect(lintText(`${"word ".repeat(30).trim()}.`, "en").longSentences).toBe(0);
  });

  it("treats each bullet as its own sentence and skips table rows and code", () => {
    const text = ["- first bullet", "- second bullet", "| a | b |", "```", long, "```"].join("\n");
    const lint = lintText(text, "en");
    expect(lint.sentences).toBe(2);
    expect(lint.longSentences).toBe(0);
  });

  it("does not split on abbreviations or decimals", () => {
    expect(sentencesOf("Models, e.g. Luna scores 16.8 at none. Next sentence.")).toHaveLength(2);
    expect(sentencesOf("Das gilt z. B. für Luna. Nächster Satz.")).toHaveLength(2);
  });
});

describe("lint: repeated content", () => {
  it("flags sentences that restate each other", () => {
    const text =
      "The budget must be raised before the effort is lowered. Before lowering the effort, the budget must be raised first.";
    expect(lintText(text, "en").repeatedPairs).toBe(1);
  });

  it("does not flag distinct sentences", () => {
    const text = "Luna scores 16.8 with thinking switched off. Unused budget is never billed to the caller.";
    expect(lintText(text, "en").repeatedPairs).toBe(0);
  });

  it("ignores short sentences such as UI labels", () => {
    expect(lintText("Join room\nJoin the room\nCreate room", "en").repeatedPairs).toBe(0);
  });

  it("works on German", () => {
    const text =
      "Der SQLite Datei Zugriff über virtiofs führt zur Korruption. Über virtiofs führt der Zugriff auf die SQLite Datei zur Korruption.";
    expect(lintText(text, "de").repeatedPairs).toBe(1);
  });
});

describe("lint: word count", () => {
  it("counts words, not pipes or bullet markers", () => {
    expect(lintText("- one two\n| a | b |\n---", "en").words).toBe(4);
  });

  it("excludes fenced code", () => {
    expect(lintText("one two\n```\nconst a = 1\n```\nthree", "en").words).toBe(3);
  });
});

describe("judges and labs", () => {
  it("maps ids to labs", () => {
    expect(labOf("claude-opus-5-5")).toBe("anthropic");
    expect(labOf("gemini-4-argon")).toBe("google");
    expect(labOf("gpt-6-astra")).toBe("openai");
    expect(labOf("deepseek-v4.1-flash")).toBe("other");
  });

  it("never lets a judge score its own lab", () => {
    expect(isEligibleJudge("claude-sonnet-5", "claude-opus-5-5")).toBe(false);
    expect(isEligibleJudge("gemini-3.8-flash", "gemini-4-argon")).toBe(false);
    expect(isEligibleJudge("gpt-6-luna", "gpt-6-astra")).toBe(false);
    expect(isEligibleJudge("claude-sonnet-5", "gpt-6-astra")).toBe(true);
    expect(isEligibleJudge("gpt-6-luna", "claude-fable-5-1")).toBe(true);
  });

  it("an unknown-lab judge only excludes its own id", () => {
    expect(isEligibleJudge("deepseek-v4.1-flash", "claude-opus-5-5")).toBe(true);
    expect(isEligibleJudge("deepseek-v4.1-flash", "deepseek-v4.1-flash")).toBe(false);
  });
});

describe("blind shuffling", () => {
  const models = ["a", "b", "c", "d", "e"];

  it("is deterministic per seed and a permutation", () => {
    expect(seededShuffle(models, "s1")).toEqual(seededShuffle(models, "s1"));
    expect(seededShuffle(models, "s1").toSorted()).toEqual(models);
  });

  it("differs across seeds", () => {
    const orders = new Set(["s1", "s2", "s3", "s4", "s5", "s6"].map((s) => seededShuffle(models, s).join("")));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("labels A..E in shuffled order", () => {
    const assigned = blindAssign(models, "x");
    expect(assigned.map((a) => a.label)).toEqual(["A", "B", "C", "D", "E"]);
    expect(assigned.map((a) => a.model).toSorted()).toEqual(models);
  });
});

function judgeReply(labels: string[], score = 4): string {
  return JSON.stringify({
    scores: Object.fromEntries(
      labels.map((l) => [l, Object.fromEntries(CRITERIA.map((c) => [c, { score, reason: "fine" }]))]),
    ),
  });
}

describe("parseJudgeJson", () => {
  it("accepts a well-formed reply, fenced or with prose around it", () => {
    const body = judgeReply(["A", "B"]);
    expect(parseJudgeJson(body, ["A", "B"], CRITERIA).ok).toBe(true);
    expect(parseJudgeJson(`\`\`\`json\n${body}\n\`\`\``, ["A", "B"], CRITERIA).ok).toBe(true);
    expect(parseJudgeJson(`Here you go: ${body} Hope that helps.`, ["A", "B"], CRITERIA).ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const result = parseJudgeJson("{not json", ["A"], CRITERIA);
    expect(result).toEqual({ ok: false, error: "reply is not valid JSON" });
  });

  it("rejects a missing label or criterion", () => {
    expect(parseJudgeJson(judgeReply(["A"]), ["A", "B"], CRITERIA)).toEqual({ ok: false, error: "no scores for label B" });
    const partial = JSON.stringify({ scores: { A: { verdict_first: { score: 3, reason: "x" } } } });
    const result = parseJudgeJson(partial, ["A"], CRITERIA);
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range, fractional and non-numeric scores", () => {
    for (const bad of [0, 6, 3.5, "4"]) {
      const reply = JSON.stringify({
        scores: { A: Object.fromEntries(CRITERIA.map((c) => [c, { score: bad, reason: "x" }])) },
      });
      expect(parseJudgeJson(reply, ["A"], CRITERIA).ok).toBe(false);
    }
  });

  it("rejects a missing reason and a missing scores object", () => {
    const noReason = JSON.stringify({ scores: { A: Object.fromEntries(CRITERIA.map((c) => [c, { score: 3 }])) } });
    expect(parseJudgeJson(noReason, ["A"], CRITERIA).ok).toBe(false);
    expect(parseJudgeJson("{}", ["A"], CRITERIA).ok).toBe(false);
  });

  it("ignores extra labels", () => {
    const result = parseJudgeJson(judgeReply(["A", "Z"]), ["A"], CRITERIA);
    expect(result.ok && Object.keys(result.scores)).toEqual(["A"]);
  });
});

describe("aggregation", () => {
  it("takes the median per criterion and the mean of medians as overall", () => {
    const verdict = (judge: string, score: number) => ({
      judge,
      scores: Object.fromEntries(CRITERIA.map((c) => [c, c === "clarity" ? 5 : score])),
    });
    const cell = aggregateCell([verdict("j1", 2), verdict("j2", 4), verdict("j3", 5)], CRITERIA);
    expect(cell.perCriterion["verdict_first"]).toBe(4);
    expect(cell.perCriterion["clarity"]).toBe(5);
    expect(cell.judgeCount).toBe(3);
    expect(cell.overall).toBeCloseTo((8 * 4 + 5) / 9);
  });

  it("with two judges the median is their mean; a single judge is visible", () => {
    const cell = aggregateCell([{ judge: "j1", scores: { clarity: 3 } }], ["clarity"]);
    expect(cell.judgeCount).toBe(1);
    expect(cell.overall).toBe(3);
    expect(aggregateCell([], CRITERIA)).toMatchObject({ overall: null, judgeCount: 0 });
  });

  it("scoreCells maps labels back to candidates and skips failed or ineligible judges", () => {
    const records: JudgeRecord[] = [
      record({ judge: "j1", labels: { A: "m1", B: "m2" }, scores: judgeScores(["A", "B"], { A: 5, B: 3 }) }),
      record({ judge: "j2", labels: { A: "m2" }, scores: judgeScores(["A"], { A: 1 }) }),
      record({ judge: "j3", labels: { A: "m1" }, ok: false, scores: null }),
    ];
    const cells = scoreCells(records, [
      { task: "t", model: "m1" },
      { task: "t", model: "m2" },
      { task: "other", model: "m1" },
    ], CRITERIA);
    expect(cells[0]).toMatchObject({ model: "m1", judgeCount: 1, overall: 5 });
    expect(cells[1]).toMatchObject({ model: "m2", judgeCount: 2, overall: 2 });
    expect(cells[2]).toMatchObject({ judgeCount: 0, overall: null });
  });

  it("leaderboard averages task overalls, tracks the weakest judge count, sorts best first", () => {
    const rows = leaderboard([
      { model: "a", overall: 4, judgeCount: 3 },
      { model: "a", overall: 2, judgeCount: 1 },
      { model: "b", overall: 4.5, judgeCount: 2 },
      { model: "c", overall: null, judgeCount: 0 },
    ]);
    expect(rows.map((r) => r.model)).toEqual(["b", "a", "c"]);
    expect(rows[1]).toMatchObject({ overall: 3, tasksScored: 2, minJudges: 1 });
    expect(rows[2]).toMatchObject({ overall: null, tasksScored: 0, minJudges: null });
  });
});

describe("classifyGeneration", () => {
  it("empty text at the cap is starved, never a bad answer", () => {
    expect(classifyGeneration("length", "")).toBe("starved");
    expect(classifyGeneration("length", "  \n")).toBe("starved");
  });
  it("empty text otherwise is an error; any text is ok", () => {
    expect(classifyGeneration("stop", "")).toBe("error");
    expect(classifyGeneration("stop", "hello")).toBe("ok");
    expect(classifyGeneration("length", "partial")).toBe("ok");
  });
});

describe("tasks and prompts", () => {
  it("defines the six tasks, each with 150-400 words of facts", () => {
    expect(WRITING_TASKS.map((t) => t.id)).toEqual(["de-tech", "en-article", "landing", "ui-copy", "rewrite", "de-briefing"]);
    for (const task of WRITING_TASKS) {
      const words = task.facts.split(/\s+/).length;
      expect(words, task.id).toBeGreaterThanOrEqual(150);
      expect(words, task.id).toBeLessThanOrEqual(400);
    }
  });

  it("has the nine rubric criteria", () => {
    expect(CRITERIA).toEqual([
      "verdict_first",
      "structure",
      "no_repetition",
      "concision",
      "precision",
      "clarity",
      "visual_fit",
      "naturalness",
      "engagement",
    ]);
  });

  it("rejects an unknown task id", () => {
    expect(() => getWritingTasks(["nope"])).toThrow(/unknown task/);
    expect(getWritingTasks(["landing"])).toHaveLength(1);
  });

  it("the judge prompt carries the facts, rubric and anonymized drafts but no model names", () => {
    const task = getWritingTasks(["landing"])[0];
    if (!task) throw new Error("missing task");
    const prompt = judgePrompt({ task, drafts: [{ label: "A", text: "draft one" }, { label: "B", text: "draft two" }] });
    expect(prompt).toContain(task.facts);
    expect(prompt).toContain("### Draft A");
    expect(prompt).toContain("### Draft B");
    for (const id of CRITERIA) expect(prompt).toContain(id);
    expect(candidatePrompt(task)).toContain(task.instruction);
  });
});

describe("report builders", () => {
  const tasks = getWritingTasks(["de-tech", "ui-copy"]);
  const models = ["m1", "m2"];
  const generations: GenerationRecord[] = tasks.flatMap((t) =>
    models.map((model, i) =>
      generation({
        task: t.id,
        model,
        status: model === "m2" && t.id === "ui-copy" ? "starved" : "ok",
        text: `output of ${model} for ${t.id}`,
        costUsd: 0.1 * (i + 1),
      }),
    ),
  );
  const judgeRecords: JudgeRecord[] = [
    record({ task: "de-tech", judge: "j1", labels: { A: "m1", B: "m2" }, scores: judgeScores(["A", "B"], { A: 5, B: 3 }) }),
    record({ task: "ui-copy", judge: "j1", labels: { A: "m1" }, scores: judgeScores(["A"], { A: 4 }) }),
    record({ task: "ui-copy", judge: "j2", labels: { A: "m1" }, ok: false, scores: null, error: "reply is not valid JSON" }),
  ];
  const cells = scoreCells(
    judgeRecords,
    tasks.flatMap((t) => models.map((model) => ({ task: t.id, model }))),
    CRITERIA,
  );

  it("report.md has minimum-separator tables, leaderboard, per-task, cost and failures", () => {
    const report = buildReport({
      generatedAt: "2026-10-17T10:00:00.000Z",
      models,
      tasks,
      judges: ["j1", "j2"],
      effort: "high",
      budget: 16000,
      voicePath: "/voice.md",
      generations,
      judgeRecords,
      cells,
    });
    expect(report).toContain("## Leaderboard");
    expect(report).toContain("### de-tech");
    expect(report).toContain("### ui-copy");
    expect(report).toContain("## Cost and latency");
    expect(report).toContain("judge j2 / ui-copy: no usable scores — reply is not valid JSON");
    expect(report).toContain("generation m2 / ui-copy: starved");
    expect(report).not.toMatch(/\|-{2,}/);
    expect(report).toMatch(/\|-\|-\|/);
  });

  it("blind.md hides model names; key.json maps labels back", () => {
    const assignments = { "de-tech": blindAssign(models, "d:de-tech"), "ui-copy": blindAssign(models, "d:ui-copy") };
    const blind = buildBlind({ tasks, assignments, generations });
    expect(blind).toContain("#### A");
    expect(blind).toContain("#### B");
    expect(blind).toContain("(no output: starved)");
    expect(blind).not.toMatch(/## .*m[12]\b/);
    const key = buildKey(assignments);
    expect(Object.values(key["de-tech"] ?? {}).toSorted()).toEqual(models);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function judgeScores(labels: string[], byLabel: Record<string, number>) {
  return Object.fromEntries(
    labels.map((l) => [l, Object.fromEntries(CRITERIA.map((c) => [c, { score: byLabel[l] ?? 3, reason: "r" }]))]),
  );
}

function record(overrides: Partial<JudgeRecord>): JudgeRecord {
  return {
    task: "t",
    judge: "j",
    labels: {},
    ok: true,
    attempts: 1,
    error: null,
    raw: "",
    scores: null,
    wallMs: 1000,
    costUsd: 0.01,
    ...overrides,
  };
}

function generation(overrides: Partial<GenerationRecord>): GenerationRecord {
  return {
    task: "t",
    model: "m",
    status: "ok",
    text: "text",
    finishReason: "stop",
    wallMs: 5000,
    promptTokens: 4000,
    visibleTokens: 500,
    reasoningTokens: 3000,
    costUsd: 0.1,
    error: null,
    lint: null,
    ...overrides,
  };
}
