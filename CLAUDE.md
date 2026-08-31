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
`claude-opus-4-8` (Opus 4.8 in Claude Code), tts `elevenlabs/flash-v2.5` (Mark, IU Replicate
route; `elevenlabs/v3` for briefings — 2026-08-26, was Gemini 3.1 Flash TTS/Charon),
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

## ccbench — the agentic benchmark

`bun run bench` (`scripts/bench.ts`, `src/server/bench/`) is the only measurement here that
drives a real agent loop rather than a single call. Each run copies a committed fixture into a
throwaway sandbox, spawns `claude -p` against the IU **Anthropic** route with the model pinned
on all four `ANTHROPIC_DEFAULT_*` tiers, parses the stream-json transcript into metrics, and
grades the resulting files mechanically. Rows land in `bench_run`; the verdict lives in
`docs/decisions/claude-code-model.md`.

Things that bite:

- **It spends real money.** `--yes` is required non-interactively, mirroring `pick`. `--dry-run`
  exercises the whole pipeline against a synthetic transcript and costs nothing.
- **Never remove the isolated `CLAUDE_CONFIG_DIR`.** Without it the global CLAUDE.md, MCP
  servers, extra tools and hooks load into every sandbox (71 tools / 35k cache-creation tokens
  vs 27 / 20.5k) and the run measures dotfiles instead of the model.
- **Parallel tool use is detected by grouping assistant events on `message.id`** — the CLI emits
  one content block per event, so counting per event always yields 1. The `usage` object repeats
  identically across those events; totals must come from the `result` event or they multiply.
- **The CLI's cost figure is only valid for Claude ids.** For everything else it applies a
  Claude-tier default (over by up to 77x). `src/server/bench/cost.ts` re-prices from token counts
  against `pick_probe` rates; `--reprice` backfills stored rows. A zero-token run is `unpriced`,
  never free.
- **Graders are guarded by golden-solution tests.** Every file-based task asserts 1.00 against a
  committed reference under `fixtures/bench/<task>/.solution/`, plus a negative control. A
  silently-broken grader and a genuinely perfect field produce the same table without them.
- `bun run route-map` surveys where each id physically lands, from the gateway's
  `x-middleware-forwarded-*` headers — the only place residency is visible.

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
