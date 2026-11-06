---
name: investigate-models
description: Analyze the modelpick catalog, metrics, and probes to recommend the optimal model for a given use-case, and check it against the live agw routes. Trigger when the user asks which model to use for something (LLM work, tts/stt, the research-only embedding/vision/image/decision modalities, or a custom need), whether a better model exists for a task, to compare candidate models, or to review the current routes.
---

# Investigate Models

Reasons over modelpick's own data to answer "what should I use for X?" and "is the current
route still the best?". Inline skill — the analysis belongs in the main session so the user
can act on it (e.g. change an agw route).

## Read these first — they close most questions before the analysis starts

- **[`docs/GUIDELINES.md`](../../../docs/GUIDELINES.md)** — the settled patterns. Choosing,
  configuring, measuring, recording.
- **[`docs/decisions/model-configs.md`](../../../docs/decisions/model-configs.md)** — exact
  settings per model per wire, and which gateway leg serves what.

Four facts that resolve a large share of "which model for X":

1. **`gpt-5.6-luna`, `deepseek-v4.1-flash` and `gemini-3.8-flash` 404 on the Anthropic leg.**
   If the slot is Claude Code or an `agw` route on the `claude` harness, the candidate set is
   only Anthropic-leg ids. A route on the OpenCode harness reaches the OpenAI leg too. Check the
   slot's harness (`agw routes --format json`) before
   comparing anything.
2. **The question is often the effort, not the model.** `glm-5.3-flash` defaults to `max`, which
   spends 56x the reasoning of `high` for no better output. Ask what effort the slot runs at
   before proposing a different model.
3. **An empty response is a budget problem, not a capability one.** Raise the cap before
   concluding a model failed.
4. **Match the metric to the job.** AA `quality` is not vision evidence; `arena_german` is not
   prose evidence; a `ttft_ms` without its effort setting is not a latency claim.

## Inputs to gather

1. **The use-case.** Map it to a modality: `llm` (use the metric-driven method below), `tts`/`stt`
   (preference-based, see Notes), or `embedding | vision | image | decision` (use the research
   method below). Note hard constraints: which gateway leg must serve it? Cost ceiling?
   Latency-sensitive? Does the slot cap output tokens (if under ~1,000, every heavy-thinking
   model is disqualified — it will return empty)?

## Where the data lives

- **Current picks:** `agw routes --format json` (the central model config; Argo `/models` renders
  it next to the efficiency data). Start here: which model and effort does the slot run today?
- **Efficiency per effort:** `curl -s localhost:7727/api/efficiency` — intelligence, cost per
  task, speed and superseded flags per ArtificialAnalysis variant, `iu` access per variant, and
  each agw route mapped onto its variant. Needs the running web agent (`make verify`).
- **Per-model metrics:** `metric_snapshot` table in `modelpick.db` (leaderboard scores, list
  prices, speech lists, live measurements). Read it, never write it.
- **Access + residency:** latest `capability_probe` per model (`accessible`, `residency`).
- **Catalog:** `src/db/iu-catalog.ts` / `models` table (synced by `make models`; `owned_by` =
  backend routes, `legs` = accepting legs).

If the server or DB is unavailable, reason from `iu-catalog.ts` and the committed docs and say so.

## Method

1. **Shortlist** candidates for the use-case: right modality, IU-accessible, satisfying
   residency/cost constraints, not superseded.
2. **Compare** on intelligence / cost per task / speed / residency / access reliability (probe
   status — single-backend models flap).
3. **Recommend** a single pick with a one-to-two sentence rationale, plus the runner-up and
   why it lost. Be explicit about tradeoffs (e.g. cheaper but US-resident).
4. **Check against the current route.** If the recommendation beats what `agw routes` runs for
   that slot, say so plainly. The change itself is an edit to the agw route table in
   agent-workflows, not to this repo.

## Manual categories (embedding / vision / image / decision)

These have **no leaderboard** — `metric_snapshot` carries no quality/price for them, so
investigate via research, not metrics:

1. **Shortlist from the DB** what's actually callable: query `models` + latest
   `capability_probe` for the modality (`embedding`, or `llm` for vision = image-input
   models, or `image` for generation). Note residency where the probe confirmed it.
2. **Rank externally with `/research`** (the agw skill, off Max), **constrained to that
   shortlist** — embeddings against MTEB / retrieval benchmarks, vision against
   document/diagram-understanding evals, image-gen against LMArena Image Arena. Ask for
   price + latency + (for embeddings) dimensions/Matryoshka. The research is the rationale.
3. **Recommend one pick** honoring the user's constraints (e.g. "small over large", EU
   residency). The pick is not tracked algorithmically — re-run this when revisiting.

Note residency gotchas (e.g. the cheapest embedder may be residency-unverified while a
pricier one is EU-confirmed) and catalog hygiene (deprecated models may still be listed —
e.g. `dall-e-3`/`gpt-image-1`). Listed ≠ current.

## Notes

- Verify a model is actually callable, not just listed — `accessible` from the latest probe,
  not mere catalog presence. Listed ≠ callable.
- Audio (tts/stt) is ranked on preference plus AA's `tts_elo` / `stt_wer_index` where present —
  weigh expressiveness, residency, and demos.
