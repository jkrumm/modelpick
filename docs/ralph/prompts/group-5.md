# Group 5: External collectors (OpenRouter + artificialanalysis)

## What You're Doing

Add the external cross-check: collectors that pull structured model rankings / pricing / quality from
the OpenRouter API and the artificialanalysis API, normalized into `metric_snapshot` with a `source` and
`confidence` per metric — so the decider never trusts a single source.

## Research & Exploration First

1. **WebFetch the artificialanalysis API reference**: `https://artificialanalysis.ai/api-reference` —
   learn auth (`ARTIFICIALANALYSIS_API_KEY`), endpoints, and the response shape for model
   quality/speed/price. Don't guess the schema.
2. **WebFetch the OpenRouter API docs** (openrouter.ai/docs) — the `/models` endpoint gives
   pricing/context; check for any rankings endpoint. Auth via `OPENROUTER_API_KEY`.
3. Read the Group 3 `metric_snapshot` schema so you normalize into it correctly.

## What to Implement

1. **`app/server/collectors/openrouter.ts`**: fetch models → map to normalized metrics (price_in,
   price_out, context, any rank) with `source: 'openrouter'`.
2. **`app/server/collectors/artificialanalysis.ts`**: fetch → normalized quality / throughput / price
   metrics with `source: 'artificialanalysis'`.
3. **Normalization layer**: a shared mapper into `metric_snapshot` rows; attach `confidence` (e.g.
   direct API value = high; derived = lower). Map external model identifiers to local `model` rows where
   possible; record unmatched ones too (they inform "new models" discovery).
4. **Entry point**: `bun run collect` runs both collectors and writes snapshots.
5. Handle missing keys / non-200 gracefully (log + skip, don't crash the whole collect).

## Validation

```bash
bun run typecheck && bun run lint
bun run test        # tests against recorded fixture responses (no live API calls in tests)
```

## Commit

```
feat(collectors): OpenRouter + artificialanalysis normalized into metric_snapshot
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 5
```
