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
  secret-needing scripts wrap their command in `secrets-run run --env-file=.env.tpl`, the
  machine-role-aware shim that resolves the backend from `~/.config/secrets/backend` (cache on
  the headless mini, `op` on the MacBook) — a raw `op run` hangs on the mini since `op` isn't
  interactively signed in there. IU key in `op://common/anthropic`, leaderboard keys in
  `op://vps/modelpick`.
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
`claude-opus-5` (2026-08-02, replaced `claude-opus-4-8` on release), tts
`elevenlabs/flash-v2.5` (Mark, IU Replicate route; `elevenlabs/v3` for briefings —
2026-08-26, was Gemini 3.1 Flash TTS/Charon), stt `gpt-4o-transcribe`, embedding
`text-embedding-3-small`, vision `gemini-3.5-flash`, image `gpt-image-2`.

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
metrics (OpenRouter, ArtificialAnalysis, Epoch AI) → recommend (re-score + persist picks +
rationale). Steps are independent; one failure doesn't abort the rest, but the exit is 1.
Green tests ≠ working pipeline — confirm against live data after changes. On the mini the
`com.jkrumm.modelpick-refresh` LaunchAgent (`make refresh-setup`, 06:00, no `KeepAlive` —
a failed step must not retry all day) runs it; `make refresh-check` shows the last exit.

## Epoch AI benchmark collector

`src/server/collectors/epoch.ts` pulls Epoch AI's public benchmark export
(`https://epoch.ai/data/benchmark_data.zip` — no key, no auth) and is the only source
here that links back to real Inspect-AI eval transcripts rather than reprinting a vendor's
own claim. It covers benchmarks AA has no column for at all: `swe_bench_verified`,
`arc_agi`/`arc_agi_2`, `frontiermath`, `aider_polyglot`, and more. **Licensed CC-BY 4.0 —
attribution to Epoch AI is a licence condition**, carried in the collector's header comment
and in the generated snapshot; don't strip it if this data moves anywhere else.

`benchmark_metadata.csv` (unzipped) drives everything: it names each benchmark's
`source_file` and `score_column`, so no column is ever hardcoded per-file. Two things this
source needs that the others don't:

- **Reasoning-effort suffixes.** Epoch appends `_none/_unknown/_low/_medium/_high/_xhigh/_max`
  to `Model version` for every model it re-ran across effort settings, giving one model
  several rows per benchmark. `stripEffortSuffix()` keeps exactly one row per model per
  benchmark — the *highest* available tier, since that's what a headline leaderboard number
  means once tiers exist. Matched on a literal underscore only (`glm-5.2_max` strips;
  `qwen3.7-max`, a real model name, does not).
- **Scale normalization.** Raw scores are on whatever scale the benchmark uses (e.g.
  percentages); `scale` from the index normalizes every value onto the same 0–1 range as
  `random_baseline`/`score_ceiling` before it's stored.

The committed snapshot `src/server/collectors/epoch-benchmarks.ts` (regenerated wholesale on
every `bun run collect`, same relationship as `iu-catalog.ts` ↔ `import-portal.ts`) captures
per-benchmark `random_baseline`/`score_ceiling`/`in_eci`/`release_date`/`superseded_by` and
exports `benchmarkSaturation()` — given a benchmark and its observed scores, reports what
share of the field sits near the ceiling, i.e. whether the benchmark stopped discriminating
between models (the ccbench-field-bunching problem, but data-driven instead of eyeballed).

## ccbench — the agentic benchmark

**What it is for, and what it is not.** ccbench measures *operational fitness*: does the model
actually drive an agent loop, how fast, at what real cost, how its caching behaves, where it
times out. It is **not a quality benchmark** and must never be read as one — on the current
field 11 of 13 models score a flat 1.000, which is the correct answer to "can it hold a loop"
and no answer at all to "which is smarter". Quality comes from external leaderboards
(`metric_snapshot`), never from here. Used as a ranking it hands the pick to whatever tiebreak
is left over; used as a gate it does exactly the job it was built for.

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

`bun run cap` and the **`/bench`** route are the two readers of that data, and they share
one derivation (`src/server/bench/summary.ts`) so they cannot disagree: newest suite with a
real field → AA index → rate card → three picks (interactive / unattended worker / EU-pinned).
Neither spends anything — `cap` reads only the local SQLite file, so it needs no key, no
network and **no `op run` wrapper**. `cap` prints everything human-facing to **stderr** and
the chosen model id alone to **stdout**, which is the contract the shell alias reads;
`--json`, `--all` and `--suite <id>` are the flags. Residency and the Claude context windows
are committed snapshots in `models.ts` (`ROUTE_RESIDENCY`, `CLAUDE_CONTEXT_WINDOW`) because
`route-map` persists nothing — re-run it and update them when the route moves.

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
