---
description: Database and schema: src/db/schema.ts is the source of truth, db:push, enums, timestamps, dropping columns. Read when changing src/db or drizzle.config.ts.
paths: ["src/db/**","drizzle.config.ts"]
---

# Database / schema changes

`src/db/schema.ts` is the single source of truth; there is **no migration folder**. The schema
syncs to the SQLite file with `bun run db:push` (`drizzle-kit push`, dialect `sqlite`).

- To add/change a table or column: edit `schema.ts`, then run `bun run db:push` — it diffs the
  schema against `modelpick.db` and applies the change. No hand-written SQL, no `db:generate`.
- For a clean rebuild: `rm modelpick.db && bun run db:push && bun run db:seed`.
- Dropping a column or table needs `bunx drizzle-kit push --force`: `db:push` refuses data-loss
  statements interactively and there is no TTY in a tool call.
- Seed with `bun run db:seed` (model catalogs), demos with `bun run demos:seed`.
- German TTS comparison on `/tts`: samples live in `data/tts-compare/` (`manifest.json` tracked, `audio/`
  gitignored) and are served at request time by `/api/tts-audio/<file>`, so new samples need no rebuild.
  Regenerate with `secrets-run run --env-file=.env.tpl -- bun scripts/tts-compare.ts [--only <model>]
  [--skip-existing] [--dry-run]` (spends IU money, estimates and caps at $2.5). Record: `docs/decisions/audio-stack.md`.
  `/tts` is a listening workbench: open questions are defined in `src/server/audio/experiments.ts` (manifest ids → question, variants,
  production flag); picks persist in browser localStorage; the model comparison and voice audition sit in a collapsed reference.
- German STT comparison: the `/stt` page, its scripts and scoring were cut; the numbers are in
  `docs/decisions/audio-stack.md` §German STT comparison.
- SQLite has no native enums — they're `text({ enum: [...] })` with value tuples (`MODALITY`,
  `RESIDENCY`, …) exported from `schema.ts`. Booleans are `integer({ mode: "boolean" })`;
  timestamps are text (`CURRENT_TIMESTAMP`), which sort lexically.
