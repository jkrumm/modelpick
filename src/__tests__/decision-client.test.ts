import { describe, it, expect, vi } from "vitest";
import {
  buildDecisionRequest,
  callDecision,
  DecisionError,
  parseDecisionsResponse,
  parseSystemoneResponse,
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

// Envelopes recorded live against IU's unified endpoint, 2026-10-13.
const SYSTEMONE_ENVELOPE = JSON.stringify({
  model: "Cloudflare/clef",
  answers: {
    kind: {
      choice: "marketing",
      confidence: 0.9248,
      probabilities: { legit: 0.0538, marketing: 0.9248, phishing: 0.0214 },
      type: "choice",
    },
    spam: { noul: 0.9778, type: "noul" },
    urgency: {
      confidence: 0.6533,
      legend: { "0": "none", "1": "low", "2": "medium", "3": "high" },
      probabilities: { "0": 0.6533, "1": 0.3301, "2": 0.0122, "3": 0.0044 },
      score: 0.3676,
      type: "score",
    },
  },
  usage: {
    total_tokens: 353,
    cost: 0.00008472,
    input_tokens: 353,
    output_tokens: 0,
  },
});

// decision-1 reports no cost and does not round.
const DECISION1_ENVELOPE = JSON.stringify({
  model: "microsoft-decision-1",
  answers: {
    kind: {
      choice: "marketing",
      confidence: 0.9886123692488156,
      probabilities: {
        legit: 0.006686794593822858,
        marketing: 0.9924082461658771,
        phishing: 0.0009049592403000672,
      },
      type: "choice",
    },
    spam: { noul: 0.9980732644156198, type: "noul" },
    urgency: {
      confidence: 0.6629308934376258,
      legend: { "0": "none", "1": "low", "2": "medium", "3": "high" },
      probabilities: {
        "0": 0.07875410772028833,
        "1": 0.7471981700782193,
        "2": 0.1667224473521668,
        "3": 0.007325274849325603,
      },
      score: 1.1026188893305298,
      type: "score",
    },
  },
  usage: { input_tokens: 133, output_tokens: 3 },
});

// jev-latest answers only what it was able to; the pinned name is in `model`.
const JEV_ENVELOPE = JSON.stringify({
  model: "jev-1.13.0",
  answers: { spam: { noul: 0.97, type: "noul" } },
  usage: {
    total_tokens: 297,
    cost: 0.000011634,
    input_tokens: 277,
    output_tokens: 20,
  },
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

  it("sends registered models and unknown ids to systemone under their own name", () => {
    expect(routeFor("clef-eu")).toEqual({
      wire: "systemone",
      apiModel: "clef-eu",
    });
    expect(routeFor("decision-1")).toEqual({
      wire: "systemone",
      apiModel: "decision-1",
    });
    expect(routeFor("something-new")).toEqual({
      wire: "systemone",
      apiModel: "something-new",
    });
  });
});

describe("buildDecisionRequest", () => {
  it("builds the systemone body on the decisions base with Bearer auth and no sampling params", () => {
    const req = buildDecisionRequest({
      modelId: "clef-eu",
      state: "plain text state",
      questions: QUESTIONS,
      apiKey: "k",
    });
    expect(req.base).toBe("systemone");
    expect(req.path).toBe("/systemone");
    expect(req.headers["authorization"]).toBe("Bearer k");
    expect(req.body).toEqual({
      model: "clef-eu",
      state: "plain text state",
      questions: {
        kind: {
          type: "choice",
          instructions: "Classify.",
          criteria: { legit: "genuine", spam: "spam" },
        },
        spam: { type: "noul", instructions: "Is it spam?" },
        urg: {
          type: "score",
          instructions: "Urgency",
          criteria: ["none: x", "high: z"],
        },
      },
    });
  });

  it("passes an object state through to systemone untouched", () => {
    const state = { from: "a@b.c", subject: "hi" };
    const req = buildDecisionRequest({
      modelId: "decision-1",
      state,
      questions: QUESTIONS,
      apiKey: "k",
    });
    expect((req.body as { state: unknown }).state).toEqual(state);
  });

  it("builds the Decisions API body with typed questions matched by name", () => {
    const req = buildDecisionRequest({
      modelId: "gpt-6-luna:decisions",
      state: "state string",
      questions: QUESTIONS,
      apiKey: "k",
    });
    expect(req.base).toBe("openai");
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

describe("parseSystemoneResponse", () => {
  it("maps the answers object into neutral answers, usage and cost", () => {
    const r = parseSystemoneResponse(SYSTEMONE_ENVELOPE);
    expect(r.answers["kind"]).toEqual({
      type: "choice",
      choice: "marketing",
      confidence: 0.9248,
      probabilities: { legit: 0.0538, marketing: 0.9248, phishing: 0.0214 },
    });
    expect(r.answers["spam"]).toEqual({ type: "boolean", probability: 0.9778 });
    expect(r.answers["urgency"]).toMatchObject({
      type: "score",
      score: 0.3676,
      confidence: 0.6533,
      probabilities: { "0": 0.6533, "1": 0.3301, "2": 0.0122, "3": 0.0044 },
    });
    expect(r.usage).toEqual({
      inputTokens: 353,
      outputTokens: 0,
      costUsd: 0.00008472,
    });
    expect(r.servedModel).toBe("Cloudflare/clef");
  });

  it("reports no cost for decision-1 and keeps its unrounded probabilities", () => {
    const r = parseSystemoneResponse(DECISION1_ENVELOPE);
    expect(r.usage).toEqual({
      inputTokens: 133,
      outputTokens: 3,
      costUsd: null,
    });
    expect(r.servedModel).toBe("microsoft-decision-1");
    expect(r.answers["spam"]).toEqual({
      type: "boolean",
      probability: 0.9980732644156198,
    });
    expect(r.answers["kind"]).toMatchObject({
      choice: "marketing",
      confidence: 0.9886123692488156,
    });
  });

  it("parses jev's partial answer set", () => {
    const r = parseSystemoneResponse(JEV_ENVELOPE);
    expect(Object.keys(r.answers)).toEqual(["spam"]);
    expect(r.usage).toEqual({
      inputTokens: 277,
      outputTokens: 20,
      costUsd: 0.000011634,
    });
  });

  it("falls back to the chosen option's probability when confidence is absent", () => {
    const body = JSON.stringify({
      answers: {
        k: { type: "choice", choice: "a", probabilities: { a: 0.7, b: 0.3 } },
      },
    });
    expect(parseSystemoneResponse(body).answers["k"]).toMatchObject({
      type: "choice",
      confidence: 0.7,
    });
  });

  it("rejects an envelope without an answers object", () => {
    expect(() =>
      parseSystemoneResponse(JSON.stringify({ model: "x" })),
    ).toThrow(DecisionError);
    expect(() => parseSystemoneResponse("not json")).toThrow(DecisionError);
  });

  it("rejects a probability outside [0, 1]", () => {
    const body = JSON.stringify({
      answers: { s: { type: "noul", noul: 1.4 } },
    });
    expect(() => parseSystemoneResponse(body)).toThrow(DecisionError);
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
    baseUrls: {
      openai: "https://ue.example/openai/v1/",
      systemone: "https://ue.example/decisions/v1/",
    },
    apiKey: "k",
  };
  // QUESTIONS asks for `kind`, `spam` and `urg`; the recorded envelope names its
  // third question `urgency`, so rename it for the all-answered case.
  const answered = (): string => {
    const env = JSON.parse(SYSTEMONE_ENVELOPE) as {
      answers: Record<string, unknown>;
    };
    env.answers["urg"] = env.answers["urgency"];
    delete env.answers["urgency"];
    return JSON.stringify(env);
  };

  it("posts systemone to the decisions base and returns the parsed result", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(answered(), { status: 200 }),
    );
    const r = await callDecision({ ...base, modelId: "clef", fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://ue.example/decisions/v1/systemone",
    );
    expect(Object.keys(r.answers).toSorted()).toEqual(["kind", "spam", "urg"]);
  });

  it("posts Luna's entry to the openai base", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(DECISIONS_ENVELOPE, { status: 200 }),
    );
    await callDecision({ ...base, modelId: "gpt-6-luna:decisions", fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://ue.example/openai/v1/decisions",
    );
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
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JEV_ENVELOPE, { status: 200 }),
    );
    await expect(
      callDecision({ ...base, modelId: "jev-latest", fetchImpl }),
    ).rejects.toThrow(/no answer for question "kind"/);
  });
});
