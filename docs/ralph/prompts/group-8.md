# Group 8: Decider + catalog UI

## What You're Doing

Build the public face of the LLM decider: category recommendation cards, a filterable model catalog, and
charts — all wired to the data layer (recommendations, snapshots, probes) via server functions, using
the Group 7 chart primitives and Mantine.

## Research & Exploration First

1. Read the server query module (Group 3) and the recommender output (Group 6) so the UI reads real shapes.
2. Read the Group 7 chart primitives and `~/.claude/rules/visx-charts.md`.
3. Look at Argo's page/layout patterns for Mantine composition.

## What to Implement

1. **Decider route (`/`)**: a card per category (fast / coding / orchestrator / tts / stt) showing the
   current pick, score breakdown (the weighted components), the LLM rationale, and runners-up.
2. **Weight sliders**: adjust quality/cost/speed weights and re-rank live (call the scoring server fn or
   recompute client-side from snapshot data — pick the simpler).
3. **Top filter bar**: "IU-available only" toggle, residency (EU/US), price ceiling.
4. **Catalog route**: sortable/filterable table + model detail cards (metrics, sources, residency, IU
   access badge, trend sparkline).
5. **Charts** (Group 7 primitives): quality-vs-price scatter, throughput bars, trend-over-time lines.
6. Public pages should be SSR/prerender-friendly and read cached snapshot data (cheap, no live IU calls).

## Validation

```bash
bun run typecheck && bun run lint
bun run test
bun run build       # SSR/prerender builds clean
```

## Commit

```
feat(decider): category cards, catalog, charts, weight sliders + filters
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 8
```
