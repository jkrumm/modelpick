# Group 10: Daily refresh + news

## What You're Doing

Wire the daily pipeline that keeps the public site fresh: one orchestrated job that probes the IU
endpoint, collects external metrics, recomputes scores/recommendations, writes a dated snapshot, and
triggers re-render of the prerendered pages. Plus a curated "new reasonable models" news feed.

## Research & Exploration First

1. Read the entry points from Groups 4–6 (`probe`, `collect`, `recommend`) — the refresh composes them.
2. Check how TanStack Start invalidates/regenerates prerendered routes (revalidation API) via WebFetch.
3. Decide the scheduler: in-process `node-cron` for dev, plus a documented host cron/launchd for prod
   (the actual prod schedule is wired at deploy in Group 11 — here just make it runnable + documented).

## What to Implement

1. **`bun run refresh`**: orchestrates probe → collect → recompute (recommend) → write `metric_snapshot`
   dated row set → trigger re-render/revalidate of public pages. Idempotent; logs a summary; one failing
   sub-step shouldn't abort the others silently (collect partial, mark gaps).
2. **News collector**: gather notable new model releases into `news_item`, **filtered to reasonable ones**
   (heuristic: from the sources you already hit / a small curated allowlist — no scraping). Mark
   `reasonable` so the UI can filter the firehose.
3. **News surface**: a simple feed component/section in the app reading `news_item`.
4. **Schedule**: dev scheduler + a documented prod cron entry (don't install host cron here).

## Validation

```bash
bun run typecheck && bun run lint
bun run test        # orchestration tests (sub-steps mocked; partial-failure handling)
```

## Commit

```
feat(refresh): daily snapshot/recompute/re-render pipeline + news feed
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 10
```
