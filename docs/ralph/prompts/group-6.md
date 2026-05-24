# Group 6: Scoring + recommender

## What You're Doing

Turn the gathered data into a decision: a transparent weighted scoring engine that ranks candidates per
category (filtered to IU-available), plus a cheap LLM that writes a one-to-two-sentence rationale for
each pick. Results persist to `recommendation`.

## Research & Exploration First

1. Read the `metric_snapshot`, `capability_probe`, and `recommendation` schemas (Group 3).
2. Decide the cheap rationale model: a small IU chat model (e.g. `gpt-4o-mini` or `claude-haiku-4-5-eu`)
   via the Group 4 IU client. Keep the prompt tiny + temperature low.
3. Re-read the category definitions in `PRD.md` (fast / coding / orchestrator / tts / stt).

## What to Implement

1. **Normalizer** (`app/server/scoring/normalize.ts`): per modality, normalize each metric to 0–1
   (higher = better; invert price). Reconcile multiple sources per metric (weighted by `confidence`).
2. **Score** (`app/server/scoring/score.ts`): `score = wQ·quality + wC·cost + wS·speed`, with default
   weights per category (e.g. orchestrator weights quality high; fast weights speed+cost). Weights are
   parameters (the UI will pass overrides in Group 8). Filter to `accessible` models only when the
   "IU-available" flag is set.
3. **Recommender** (`app/server/scoring/recommend.ts`): top pick + runners-up per category; for each
   pick, call the cheap IU model to write a 1–2 sentence "why this one" rationale referencing the score
   drivers. Persist to `recommendation` with `snapshot_date`.
4. **Entry point**: `bun run recommend`.

## Validation

```bash
bun run typecheck && bun run lint
bun run test        # deterministic tests on normalize + score math (rationale LLM mocked)
```

The score must be fully deterministic and unit-tested; the LLM only narrates (mock it in tests).

## Commit

```
feat(scoring): weighted score + per-category recommender with LLM rationale
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 6
```
