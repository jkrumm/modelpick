---
name: investigate-models
description: Analyze the modelpick catalog, metrics, and probes to recommend the optimal model for a given use-case, and surface My Stack drift. Trigger when the user asks which model to use for something (scored fast/coding/orchestrator/tts/stt, the research-only embedding/vision/image categories, or a custom need), whether a better model exists for a task, to compare candidate models, or to review/refresh their decided stack.
---

# Investigate Models

Reasons over modelpick's own data to answer "what should I use for X?" and "is my current
pick still the best?". Inline skill — the analysis belongs in the main session so the user
can act on it (e.g. update My Stack).

## Inputs to gather

1. **The use-case / category.** Map it to a **scored** category (`fast | coding |
   orchestrator | tts | stt`) and use the metric-driven method below, or a **manual**
   category (`embedding | vision | image`) and use the research method below; otherwise
   reason from raw metrics. Note hard constraints: EU residency required? Must be
   IU-accessible? Cost ceiling? Latency-sensitive?

## Where the data lives

- **My current picks + drift:** the `/stack` page / `getMyStack` server fn
  (`src/routes/-stack-server-fns.ts`) — start here; if a category already shows `review`,
  that's the lead.
- **Algorithmic picks + rationale:** latest `recommendation` rows (`bun run recommend`
  regenerates them). Weights/floors: `src/server/scoring/score.ts`
  (`CATEGORY_WEIGHTS`, `CATEGORY_MIN_QUALITY`).
- **Per-model metrics:** `metric_snapshot` (quality from ArtificialAnalysis, price from
  OpenRouter, throughput/latency). Normalization: `src/server/scoring/normalize.ts`.
- **Access + residency:** latest `capability_probe` per model (`accessible`, `residency`).
- **Catalog:** `src/db/iu-catalog.ts` / `models` table.

To query live data, prefer a short read against the DB or rerun `bun run recommend` /
`bun run probe`; if no DB is available, reason from `iu-catalog.ts` + the latest committed
metrics and say so.

## Method

1. **Shortlist** candidates for the use-case: right modality, IU-accessible, above the
   category's min-quality floor, satisfying residency/cost constraints.
2. **Compare** on quality / cost / speed / residency / access reliability (probe status —
   single-backend models flap). Use the category weight profile if one applies.
3. **Recommend** a single pick with a one-to-two sentence rationale, plus the runner-up and
   why it lost. Be explicit about tradeoffs (e.g. cheaper but US-resident).
4. **Check against My Stack.** If the recommendation beats the current `stack_choice` for
   that category, say so plainly and offer to update it.

## Manual categories (embedding / vision / image)

These have **no leaderboard** — `metric_snapshot` carries no quality/price for them, so the
recommender never scores them and there is no drift signal. Investigate via research, not
metrics:

1. **Shortlist from the DB** what's actually callable: query `models` + latest
   `capability_probe` for the modality (`embedding`, or `llm` for vision = image-input
   models, or `image` for generation). Note residency where the probe confirmed it.
2. **Rank externally with `/research`** (sideclaw, off Max), **constrained to that
   shortlist** — embeddings against MTEB / retrieval benchmarks, vision against
   document/diagram-understanding evals, image-gen against LMArena Image Arena. Ask for
   price + latency + (for embeddings) dimensions/Matryoshka. The research is the rationale.
3. **Recommend one pick** honoring the user's constraints (e.g. "small over large", EU
   residency), then update My Stack as below. The pick is recorded, not algorithmically
   tracked — re-run this when revisiting.

Note residency gotchas (e.g. the cheapest embedder may be residency-unverified while a
pricier one is EU-confirmed) and catalog hygiene (deprecated models may still be listed —
e.g. `dall-e-3`/`gpt-image-1`). Listed ≠ current.

## Updating My Stack

If the user accepts a new pick, edit `MY_STACK` in `src/db/seed.ts`: change `model_id`
(and `env_note`/`rationale`), **bump `decided_at`** to today, then `bun run db:seed` to
upsert. Commit: `feat(stack): switch <category> to <model>`. Manual categories
(embedding/vision/image) are added/edited the same way — they just never get a
`recommendation` row.

## Notes

- Verify a model is actually callable, not just listed — `accessible` from the latest probe,
  not mere catalog presence. Listed ≠ callable.
- Audio (tts/stt) has no leaderboard; ranking is preference-based
  (`audioQualityRank` in the recommender) — weigh expressiveness, residency, and demos.
