# Gemini on IU: two tool-calling shapes, two different answers

**Verdict:** the multi-round agent-loop penalty that keeps `gemini-3.8-flash` out of the
Hermes brain ([hermes-brain.md](./hermes-brain.md)) **does not transfer** to a service whose
lead model only does single-shot forced `tool_choice` structured output. On that shape Gemini
3.8 is *faster* than `gpt-5.6-luna`, works on the plain `/openai` transport, and needs no new
client code. Whether to switch is then a residency question, not a benchmark question.

Measured 2026-09-04, 3 passes per config, live against the IU unified endpoint.

## The two shapes

| | Multi-round agent loop | Single-shot forced tool |
|-|-|-|
| Call pattern | model → tool call → **tool result back** → model → … | model → one tool call → done |
| Where it appears | `benchmark-bakeoff.ts` tools suite; Hermes skill dispatch; `research-gateway`'s `worker.ts` (`stopWhen` + `activeTools`) | `research-gateway`'s `plan.ts` and `synthesize.ts` (`toolChoice: { type: 'tool' }`) |
| Thought signatures | must survive every round-trip | never round-tripped — irrelevant |

The distinction is load-bearing because everything expensive about Gemini here — the thinking
budget, the variance, the thought-signature handling, the gateway rerouting — is triggered by
sending a tool *result* back. A forced single-shot call never does.

## Multi-round loop (scripted 3-tool scenario)

| Config | Total, 3 passes | Tools | Cost |
|-|-|-|-|
| Luna, `reasoning_effort=none` | **3.0 / 3.2 / 3.6s** | 3/3 | $0.0004 |
| Luna, default | 4.4 / 4.9 / 5.1s | 3/3 | $0.0006 |
| Gemini 3.8 `/openai`, `reasoning_effort=none` | 5.8 / 5.9 / 11.9s | 3/3 | $0.0015–0.0063 |
| Gemini 3.8 native, `thinkingLevel=low` | 9.8 / 12.0 / 15.0s | 3/3 | $0.0077–0.0119 |
| Gemini 3.8 native, default thinking | 15.4 / 21.2 / 35.5s | 3/3 | $0.0132–0.0201 |

Luna wins on every axis: 2–4× faster, 4–16× cheaper, and far tighter variance. No config fails
the scenario — the earlier "2/3 tools, did not finish" and "34.9s regression" readings were
harness bugs, see below.

## Single-shot forced tool (synthesis-shaped: 3 digests → structured report)

| Config | Latency, 3 passes | Valid args | Region header | Findings returned |
|-|-|-|-|-|
| Gemini 3.8 `/openai`, `reasoning_effort=none` | **2.5 / 3.5 / 4.5s** | 3/3 | none | 4 / 4 / 4 |
| Gemini 3.8 native, `thinkingLevel=low` | 2.7 / 5.4 / 5.7s | 3/3 | none | 4 / 4 / 4 |
| Gemini 3.8 native, default | 4.6 / 4.8 / 5.7s | 3/3 | none | 4 / 4 / 4 |
| Luna, `reasoning_effort=none` | 5.5 / 5.9 / 6.4s | 3/3 | `Sweden Central` | 5 / 6 / 6 |
| Gemini 3.8 `/openai`, default | 4.9 / 5.4 / 12.3s | 3/3 | none | 4 / 4 / 5 |
| Luna, default | 5.8 / 6.6 / 6.7s | 3/3 | `Sweden Central` | 5 / 6 / 6 |

The ordering **inverts**. Gemini 3.8 on `/openai` with `reasoning_effort=none` is ~2× faster
than Luna's best config on the exact shape a research lead model uses, and returns valid
schema-conformant args every time.

One soft signal against it: the prompt asked for "at least 4 findings and 2 open questions".
Gemini returned exactly the floor on all 6 runs; Luna returned 5–6 findings and 2–3 open
questions on all 6. That is not a correctness failure and one prompt is thin evidence, but it
is a consistent difference in how much the model volunteers — worth an A/B on real reports
before switching a synthesis step, since floor-hugging is exactly the failure a schema cannot
catch.

## Two harness bugs that produced the wrong first answer

Both lived in `scripts/benchmark-bakeoff.ts`, both are fixed:

1. **`maxOutputTokens: 500` in the tool suite.** Gemini 3 bills thinking against that cap. A
   thinking-heavy round spent the whole budget on thoughts, returned an empty candidate, and
   the harness scored it as "dropped a tool, did not finish". The throughput suite had already
   been raised to 4000 with a comment explaining exactly this; the tool suite hadn't.
2. **The `/openai` loop dropped Gemini's thought signature.** On the OpenAI-compat route Gemini
   returns it as `tool_calls[].extra_content.google.thought_signature`. The harness rebuilt the
   assistant message from `id`/`name`/`arguments` and lost it; the next request then 503'd out
   of the LiteLLM GDPR gateway wrapping an upstream Vertex **404**. That error is very easy to
   misread as "the model has no EU deployment" — it is what made both the 3.7 and 3.8 rounds
   conclude `/openai` was unusable for Gemini agent loops. Echo the assistant message back
   verbatim and it returns 200.

The second one has a consequence beyond the benchmark: **the OpenAI-compat path already carries
thought signatures**, so integrating Gemini does not require Google's SDK or a raw
`/gemini/v1beta` client. Whether a given SDK preserves `extra_content` on the round-trip is the
thing to verify — for the AI SDK's `createOpenAICompatible`, unverified as of this writing, and
only relevant to a multi-round caller.

## Residency

Unchanged and unresolved: `gemini-3.8-flash` returns no `x-ms-region` header on either
transport; `gpt-5.6-luna` verifies `Sweden Central` on every call. Only `gemini-3.5-flash-eu`
and `gemini-2.5-pro-eu` have EU aliases. For anything touching personal data this decides the
question before any latency number does.
