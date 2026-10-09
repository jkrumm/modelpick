import { describe, it, expect, vi } from "vitest";
import {
  buildDecisionRequest,
  callDecision,
  DecisionError,
  parseDecisionsResponse,
  parseQuestionsResponse,
  routeFor,
  type DecisionQuestion,
} from "../server/iu/decision-client.js";

const QUESTIONS: Record<string, DecisionQuestion> = {
  kind: {
    type: "choice",
    instructions: "Classify.",
    criteria: { legit: "genuine", spam: "spam" },
  },
  spam: { type: "boolean", instructions: "Is it spam?" },
  urg: {
    type: "score",
    instructions: "Urgency",
    levels: [
      { label: "none", description: "x" },
      { label: "high", description: "z" },
    ],
  },
};

// Envelopes recorded live against IU's unified endpoint, 2026-10-09.
const QUESTIONS_ENVELOPE = JSON.stringify({
  choices: [
    {
      finish_reason: "stop",
      index: 0,
      message: {
        content: JSON.stringify({
          kind: {
            choice: "seo",
            confidence: 0.9036,
            probabilities: { other: 0.0964, seo: 0.9036 },
            type: "choice",
          },
          spam: { noul: 0.983, type: "noul" },
          urg: {
            confidence: 0.8847,
            legend: { "0": "none", "1": "high" },
            probabilities: { "0": 0.8847, "1": 0.1153 },
            score: 0.1304,
            type: "score",
          },
        }),
        role: "assistant",
      },
    },
  ],
  model: "Cloudflare/clef",
  usage: { completion_tokens: 0, prompt_tokens: 279, total_tokens: 279, cost: 0.00006696 },
});

const DECISIONS_ENVELOPE = JSON.stringify({
  model: "gpt-6-luna",
  answers: [
    { type: "predicate", name: "spam", probability: 0.85 },
    {
      type: "choice",
      name: "kind",
      choice: "spam",
      probabilities: [
        { value: "legit", probability: 0.04 },
        { value: "spam", probability: 0.96 },
      ],
      confidence: 0.92,
    },
    {
      type: "score",
      name: "urg",
      score: 1.23,
      probabilities: [
        { value: 0, label: "none", probability: 0.22 },
        { value: 1, label: "high", probability: 0.78 },
      ],
      confidence: 0.0,
    },
  ],
  usage: { input_tokens: 376, output_tokens: 0, total_tokens: 376 },
});

describe("routeFor", () => {
  it("sends Luna's decisions entry to /decisions under its chat model name", () => {
    expect(routeFor("gpt-6-luna:decisions")).toEqual({ wire: "decisions", apiModel: "gpt-6-luna" });
  });

  it("defaults every other id to the questions wire", () => {
    expect(routeFor("clef-eu")).toEqual({ wire: "questions", apiModel: "clef-eu" });
    expect(routeFor("something-new")).toEqual({ wire: "questions", apiModel: "something-new" });
  });
});

describe("buildDecisionRequest", () => {
  it("builds the chat/completions questions body with api-key and no sampling params", () => {
    const req = buildDecisionRequest({
      modelId: "clef-eu",
      state: { a: 1 },
      questions: QUESTIONS,
      apiKey: "k",
    });
    expect(req.path).toBe("/chat/completions");
    expect(req.headers["api-key"]).toBe("k");
    expect(req.body).toEqual({
      model: "clef-eu",
      stream: false,
      messages: [{ role: "user", content: '{"a":1}' }],
      response_format: {
        type: "questions",
        questions: {
          kind: {
            type: "choice",
            instructions: "Classify.",
            criteria: { legit: "genuine", spam: "spam" },
          },
          spam: { type: "noul", instructions: "Is it spam?" },
          urg: { type: "score", instructions: "Urgency", criteria: ["none: x", "high: z"] },
        },
      },
    });
  });

  it("builds the Decisions API body with typed questions matched by name", () => {
    const req = buildDecisionRequest({
      modelId: "gpt-6-luna:decisions",
      state: "state string",
      questions: QUESTIONS,
      apiKey: "k",
    });
    expect(req.path).toBe("/decisions");
    expect(req.headers["authorization"]).toBe("Bearer k");
    expect(req.body).toEqual({
      model: "gpt-6-luna",
      input: "state string",
      questions: [
        {
          type: "choice",
          name: "kind",
          instructions: "Classify.",
          choices: [
            { value: "legit", description: "genuine" },
            { value: "spam", description: "spam" },
          ],
        },
        { type: "predicate", name: "spam", instructions: "Is it spam?" },
        {
          type: "score",
          name: "urg",
          instructions: "Urgency",
          levels: [
            { label: "none", description: "x" },
            { label: "high", description: "z" },
          ],
        },
      ],
    });
  });
});

describe("parseQuestionsResponse", () => {
  it("unwraps the JSON-string content into neutral answers, usage and cost", () => {
    const r = parseQuestionsResponse(QUESTIONS_ENVELOPE);
    expect(r.answers["kind"]).toEqual({
      type: "choice",
      choice: "seo",
      confidence: 0.9036,
      probabilities: { other: 0.0964, seo: 0.9036 },
    });
    expect(r.answers["spam"]).toEqual({ type: "boolean", probability: 0.983 });
    expect(r.answers["urg"]).toMatchObject({ type: "score", score: 0.1304, confidence: 0.8847 });
    expect(r.usage).toEqual({ inputTokens: 279, outputTokens: 0, costUsd: 0.00006696 });
    expect(r.servedModel).toBe("Cloudflare/clef");
  });

  it("falls back to the chosen option's probability when confidence is absent", () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              k: { type: "choice", choice: "a", probabilities: { a: 0.7, b: 0.3 } },
            }),
          },
        },
      ],
    });
    const answer = parseQuestionsResponse(body).answers["k"];
    expect(answer).toMatchObject({ type: "choice", confidence: 0.7 });
  });

  it("rejects an envelope whose content is not JSON", () => {
    const body = JSON.stringify({ choices: [{ message: { content: "not json" } }] });
    expect(() => parseQuestionsResponse(body)).toThrow(DecisionError);
  });

  it("rejects a probability outside [0, 1]", () => {
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ s: { type: "noul", noul: 1.4 } }) } }],
    });
    expect(() => parseQuestionsResponse(body)).toThrow(DecisionError);
  });
});

describe("parseDecisionsResponse", () => {
  it("flattens array-of-record probabilities and reports no cost", () => {
    const r = parseDecisionsResponse(DECISIONS_ENVELOPE);
    expect(r.answers["spam"]).toEqual({ type: "boolean", probability: 0.85 });
    expect(r.answers["kind"]).toEqual({
      type: "choice",
      choice: "spam",
      confidence: 0.92,
      probabilities: { legit: 0.04, spam: 0.96 },
    });
    expect(r.answers["urg"]).toEqual({
      type: "score",
      score: 1.23,
      confidence: 0,
      probabilities: { "0": 0.22, "1": 0.78 },
    });
    expect(r.usage).toEqual({ inputTokens: 376, outputTokens: 0, costUsd: null });
  });

  it("surfaces a refusal as its own answer type instead of throwing", () => {
    const body = JSON.stringify({
      answers: [{ type: "refusal", name: "kind", refusal: "cannot assess" }],
    });
    expect(parseDecisionsResponse(body).answers["kind"]).toEqual({
      type: "refusal",
      message: "cannot assess",
    });
  });
});

describe("callDecision", () => {
  const base = {
    state: "s",
    questions: QUESTIONS,
    baseUrl: "https://ue.example/openai/v1/",
    apiKey: "k",
  };

  it("posts to the wire's URL and returns the parsed result", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(QUESTIONS_ENVELOPE, { status: 200 }),
    );
    const r = await callDecision({ ...base, modelId: "clef", fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://ue.example/openai/v1/chat/completions");
    expect(Object.keys(r.answers)).toEqual(["kind", "spam", "urg"]);
  });

  it("throws a DecisionError carrying the status on a non-2xx", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("rate limited", { status: 429 }),
    );
    await expect(callDecision({ ...base, modelId: "clef", fetchImpl })).rejects.toMatchObject({
      name: "DecisionError",
      status: 429,
    });
  });

  it("throws when the model answers fewer questions than were asked", async () => {
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ spam: { type: "noul", noul: 0.5 } }) } }],
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
    await expect(callDecision({ ...base, modelId: "clef", fetchImpl })).rejects.toThrow(
      /no answer for question "kind"/,
    );
  });
});
