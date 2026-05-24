# Group 3: DB layer (Drizzle + schema)

## What You're Doing

Set up Drizzle ORM against the local Postgres (`DATABASE_URL`, port 5433) and define the schema that
every later group reads/writes: models, capability probes, metric snapshots, recommendations, audio
demos, news. Migrations run clean; a typed query module wraps access.

## Research & Exploration First

1. **Verify current Drizzle ORM + drizzle-kit versions and the Postgres setup API** via WebFetch of the
   Drizzle docs. Don't assume the config shape.
2. Look at `~/SourceRoot/argo` for the Drizzle + Postgres pattern (connection, migrations, query style).
3. Bring up the DB: `make db-up` (compose Postgres on 5433). Confirm `DATABASE_URL` connects.

## What to Implement

1. **Drizzle config** + connection module (reads `DATABASE_URL`).
2. **Schema** (`drizzle/schema.ts`), tables roughly:
   - `model` — id, provider, family, **modality** enum (`llm` | `tts` | `stt`), display_name, context,
     created_at.
   - `capability_probe` — model ref, `accessible` bool, `latency_ms`, `residency` enum (`eu`|`us`|`unknown`), checked_at.
   - `metric_snapshot` — model ref, `source` (iu|openrouter|artificialanalysis), `metric`
     (quality|price_in|price_out|throughput|...), `value` numeric, `confidence`, captured_at.
   - `recommendation` — `category` (fast|coding|orchestrator|tts|stt), model ref, `score`, `rationale`,
     snapshot_date.
   - `demo` — modality, model, text, lang (de|en), emotion/preset, `audio_path`, `public` bool, created_at.
   - `news_item` — title, url, source, summary, published_at, model_ref?, reasonable bool.
   Adjust shapes as sensible; keep them normalized but simple.
3. **Migrations** via drizzle-kit; generate + apply to local DB.
4. **Query module** (`app/server/db/`): typed helpers for the reads later groups need (latest snapshot,
   recommendations by date, accessible models, public demos).
5. **Seed**: optional minimal seed of the model inventory from the memo so the UI has data before probes run.

## Validation

```bash
make db-up
bun run typecheck && bun run lint
bun run test        # schema/query unit tests (mock or test DB)
# verify migration applies cleanly against local DATABASE_URL
```

## Commit

```
feat(db): drizzle schema + migrations + query module
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 3
```
