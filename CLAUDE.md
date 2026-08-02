# modelpick — Project Instructions

## What this is

modelpick is **the place I decide which models to use for what**, and keep that decision
current. It ranks the LLM/TTS/STT models reachable through the **IU unified endpoint**
against external leaderboards (OpenRouter, ArtificialAnalysis) and live access probes, then
records the models I have actually committed to. It is the single source of truth for model
choice — rationale that used to live scattered in `dotfiles` now consolidates here (see
`docs/decisions/`).

Local-only, one-person curation. Not deployed, not production-critical. All state lives in a
single SQLite file (`modelpick.db`, gitignored).

## Stack

- **TanStack Start** (React 19, SSR) — routes in `src/routes/`, server logic via
  `createServerFn` in colocated `-*-server-fns.ts` files (no separate API).
- **Mantine** UI + **visx** charts (charts follow the global `visx-charts` rule:
  `ChartCard`/`ChartLegend`/`ChartTooltip` primitives, `useVxTheme()`, no raw hex).
- **Drizzle ORM + local SQLite** (libsql, `@libsql/client`), schema in `src/db/schema.ts`.
  The driver (`drizzle-orm/libsql`) runs under both node (the SSR server) and bun (the scripts).
- **Secrets via 1Password** — no plaintext `.env`. `.env.tpl` (tracked) holds `op://` refs; the
  secret-needing scripts wrap their command in `op run --account tkrumm --env-file=.env.tpl`. IU
  key in `op://common/anthropic`, leaderboard/admin keys in `op://vps/modelpick`. You must be
  signed into `op` to run `dev`/`refresh`/`probe`/etc.
- **Makefile targets**: `make dev`, `make build`, `make db-push`, `make db-seed`.

## The category model

Two tiers (`schema.ts`):

- **Scored** (`CATEGORY` = `fast | coding | orchestrator | tts | stt`) — driven by the
  recommender. Each has its own weight profile (`CATEGORY_WEIGHTS` in
  `src/server/scoring/score.ts`) and a min-quality floor so cheap models can't win on price
  alone.
- **Manual** (`MANUAL_CATEGORY` = `embedding | vision | image`) — no public leaderboard
  scores these, so there is **no algorithmic recommendation** and no drift flag. They live in
  My Stack with a research-backed rationale; refresh via `/research` + `/investigate-models`.

`STACK_CATEGORY` is the union (scored + manual) and types `stack_choice.category`;
`recommendation.category` stays scored-only.

## My Stack (`/stack`)

`stack_choice` table holds my **deliberate** pick per category, separate from the
algorithmic `recommendation`. The `/stack` page diffs the two and flags **drift** when the
algorithm prefers a different model — my cue to reconsider. Picks live in `MY_STACK` in
`src/db/seed.ts` (upserted on category); revise there and bump `decided_at` when a choice
actually changes. Manual categories carry no `recommendation`, so the `/stack` page shows
them as "no recommendation" (gray `—`) rather than ok/drift. Current picks: fast
`DeepSeek-V4-Flash`, coding `DeepSeek-V4-Flash` (2026-08-02, was `DeepSeek-V4-Pro` — see
`docs/decisions/coding-model.md`; GPT-5.5 dropped as too expensive), orchestrator
`claude-opus-4-8` (Opus 4.8 in Claude Code), tts `gemini-3.1-flash-tts-preview` (Charon),
stt `gpt-4o-transcribe`, embedding `text-embedding-3-small`, vision `gemini-3.5-flash`,
image `gpt-image-2`.

## Database / schema changes

`src/db/schema.ts` is the single source of truth; there is **no migration folder**. The schema
syncs to the SQLite file with `bun run db:push` (`drizzle-kit push`, dialect `sqlite`).

- To add/change a table or column: edit `schema.ts`, then run `bun run db:push` — it diffs the
  schema against `modelpick.db` and applies the change. No hand-written SQL, no `db:generate`.
- For a clean rebuild: `rm modelpick.db && bun run db:push && bun run db:seed`.
- Seed with `bun run db:seed` (models + my stack), demos with `bun run demos:seed`.
- SQLite has no native enums — they're `text({ enum: [...] })` with value tuples (`MODALITY`,
  `CATEGORY`, …) exported from `schema.ts`. Booleans are `integer({ mode: "boolean" })`;
  timestamps are text (`CURRENT_TIMESTAMP`), which sort lexically.

## IU model catalog — how it stays current

The IU model list comes from the self-service portal (Blazor behind SSO, not fetchable
programmatically): <https://ue-self-service.app.iu-it.org/check-key>. Flow:
`save page HTML → bun run scripts/import-portal.ts <file>` → regenerates the committed
snapshot `src/db/iu-catalog.ts` + upserts models. Live `/v1/models` aliases (`tts`,
`whisper`, …) merge in at probe time. **Listed ≠ callable** — `bun run probe` is what
verifies real access and residency.

## Daily refresh pipeline

`bun run refresh` runs `scripts/refresh.ts` locally: probe access → collect external
metrics (OpenRouter, ArtificialAnalysis) → recommend (re-score + persist picks + rationale)
→ news. Steps are independent; one failure doesn't abort the rest. Green tests ≠ working
pipeline — confirm against live data after changes.

## Project skills

Two skills live in `.claude/skills/` and load only inside this repo. **Proactively suggest
them** when the situation matches — I rarely remember to invoke them by name:

- **`/update-iu-models`** — refresh the IU catalog from a check-key HTML export (import →
  diff → push → seed → optional probe → commit snapshot). Trigger when I mention a new
  IU model list, the check-key page, an export/HTML I saved, or that models look stale.
- **`/investigate-models`** — analyze catalog + metrics to recommend the optimal model for a
  use-case, and surface My Stack drift. Trigger when I ask "which model for X", "is there
  something better for Y", or to review my stack.

## Conventions

- TypeScript strict, no `any`. Throw/propagate errors. Typed object args.
- Fix errors only in files you change; don't refactor untouched code.
- Validate via `/check`; I run dev servers manually (don't start long-lived servers for me).
