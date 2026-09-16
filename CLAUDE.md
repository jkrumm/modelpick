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
- **Makefile targets**: `make dev`, `make build`, `make db-push`, `make db-seed`,
  `make refresh-setup|refresh-check|refresh-teardown` (the 06:00 LaunchAgent). The
  picking commands that matter day to day are bun scripts, not Makefile targets:
  `bun run bench` (ccbench), `bun run route-map`, and the `cap`/`cap --list` shell
  launchers (read `pick`'s output, spend nothing).

## The category model

Two tiers (`schema.ts`):

- **Scored** (`CATEGORY` = `fast | coding | writing | orchestrator | tts | stt`) — driven by the
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
them as "no recommendation" (gray `—`) rather than ok/drift. **Current picks are
`MY_STACK` in `src/db/seed.ts` and the live `/stack` page — not restated here**, so this
file cannot drift from them; each pick's rationale links its `docs/decisions/*.md` record.

## Deployments — the truth layer (`/stack`, section 1)

`stack_choice` answers "which model did I pick for the *coding* idea". `deployment`
answers "which model does sideclaw's JUDGE tier call today, at what reasoning budget,
wired in which file". They are different questions and the gap between them is the point:
`coding` is one stack row and six running slots, and a stack row can have **zero** slots
(the `/stack` slot-count column exists to expose exactly that).

- Rows live in **`src/db/deployments.ts`**, one per real slot across claude-code, sideclaw,
  warden, hermes, research, audio, argo, image-gen, rb, homelab. Seeded by
  `seedDeployments()` (delete-then-insert: a slot that disappears from a service's config
  must disappear here too).
- Every row carries `config_ref` — the file in the *other* repo that actually wires it —
  and `verified_at`. **`bun run verify-deployments` checks those claims mechanically**:
  it opens each `config_ref` and asserts the `model_id` is still in it. `--update` stamps
  `VERIFIED` when nothing is broken. Rows whose config uses a tier alias, an inherited
  value, or a deliberate unset set `literal_id: false` and are reported as *indirect*
  rather than passing silently.
- `/stack` flags each slot: `unresolvable` (id not in the catalog), `inaccessible`,
  `drift` (the category recommendation names a different model), `stale` (`verified_at`
  > 30 days). There is deliberately **no residency flag** — residency stays a fact on
  `capability_probe` and an argument inside a decision record, not a per-slot alarm.
- `follows_recommendation: false` marks a slot that uses its category for grouping but
  deliberately does not follow it — a Max-plan slot where the cost term is meaningless, or
  an unattended worker governed by ccbench rather than the quality-led `coding` profile.
  Without it 28 of 54 slots flagged at once, which reads as no signal at all.
  A slot with `category: null` is a **structural** pick — no category scores it, so no
  drift is possible. Do not "fix" a slot to match a category recommendation without
  reading the slot's own rationale first.

Refresh the whole loop with **`/refresh-stack`** (catalog → probe → collect → recommend →
verify-deployments → triage the drift). It never runs `bun run bench`; that spends money
and answers a different question.

## Model choice and configuration — read the guidelines, don't re-derive

**[`docs/GUIDELINES.md`](docs/GUIDELINES.md) is the settled-patterns surface** — how to choose a
model, how to configure it, how to measure one, how to record the decision. It is short and it
is current; the dated evidence sits behind it in `docs/decisions/`.
**[`docs/decisions/model-configs.md`](docs/decisions/model-configs.md)** is the rollout
reference: exact settings per model per wire, plus the gateway traps.

The four facts that decide most questions before they are asked:

- **`gpt-5.6-luna`, `deepseek-v4.1-flash` and `gemini-3.8-flash` 404 on the Anthropic leg.**
  Claude Code, every sideclaw `session` tool, `agent-dispatch` and every warden episode can only
  run `claude-*`, `glm-5.3-flash` or `minimax-m3`.
- **Thinking is the quality lever, not overhead.** Luna runs 16.8 at `none` to 37.5 at `max`.
  Set the effort explicitly — `glm-5.3-flash` defaults to `max`, which is its worst setting.
- **When a call returns empty, raise the budget before lowering the effort.** Unused budget is
  not billed. An under-budgeted reasoning model returns HTTP 200 with empty content and
  `finish_reason: length`, silently.
- **Match the metric to the job.** A score whose name matches the question is not evidence that
  it measures the question — that error has produced three wrong answers here.

`bun run bench:fast` (`scripts/bench-fast.ts`, tasks in `src/server/bench/fast-tasks.ts`)
measures the fast tier across the full effort ladder: five mechanically-graded tasks, medians,
`starved` counted separately from `fail`, and a crossover calculation for how long an output must
be before a faster decoder that starts later finishes first. It spends real money; `--dry-run`
costs nothing. Give every candidate >=16,000 tokens — two retracted verdicts in this repo came
from budget starvation being scored as failure.


## Running it always-on (mini)

`make web-setup` builds and installs the `com.jkrumm.modelpick-web` LaunchAgent on :7727,
behind the Caddy entry that already exists (`modelpick.test` → `modelpick.mini.jkrumm.com`).
`make web-check` polls `/stack` — a DB-backed page, so a 200 proves server, secrets and
SQLite together. `make web-restart` rebuilds and kickstarts.

**Deliberately a LaunchAgent, not a Docker container** like rb and linewatch. Those own
their SQLite file exclusively; modelpick's is shared with host-side writers that cannot be
containerised — `bun run bench` spawns the `claude` CLI and reads the macOS Keychain, and
the 06:00 refresh agent writes the same file. A Docker volume gives two divergent databases;
a bind mount gives the fcntl/virtiofs corruption already measured twice in this house
(linewatch 2026-07-30, work dashboard 2026-07-21/26). Same-host processes get real SQLite
locking; a VM boundary does not.

## Database / schema changes

`src/db/schema.ts` is the single source of truth; there is **no migration folder**. The schema
syncs to the SQLite file with `bun run db:push` (`drizzle-kit push`, dialect `sqlite`).

- To add/change a table or column: edit `schema.ts`, then run `bun run db:push` — it diffs the
  schema against `modelpick.db` and applies the change. No hand-written SQL, no `db:generate`.
- For a clean rebuild: `rm modelpick.db && bun run db:push && bun run db:seed`.
- Dropping a column needs `bunx drizzle-kit push --force`: `db:push` refuses data-loss
  statements interactively and there is no TTY in a tool call. Safe for `deployment`,
  which is delete-then-insert seeded from code on every run.
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
metrics (OpenRouter, ArtificialAnalysis, Epoch AI, EQ-Bench, LMArena) → recommend (re-score + persist picks +
rationale). Steps are independent; one failure doesn't abort the rest, but the exit is 1.
Green tests ≠ working pipeline — confirm against live data after changes. On the mini the
`com.jkrumm.modelpick-refresh` LaunchAgent (`make refresh-setup`, 06:00, no `KeepAlive` —
a failed step must not retry all day) runs it; `make refresh-check` shows the last exit.

## Epoch AI benchmark collector

`src/server/collectors/epoch.ts` pulls Epoch AI's public benchmark export (CC-BY 4.0 —
keep the attribution if this data moves anywhere) and is the only source here backed by
real Inspect-AI eval transcripts; it covers benchmarks AA has no column for at all
(`swe_bench_verified`, `arc_agi*`, `frontiermath`, `aider_polyglot`, …). Committed snapshot:
`src/server/collectors/epoch-benchmarks.ts`, regenerated wholesale on `bun run collect`.
Internals (effort-suffix stripping, scale normalization, `benchmarkSaturation()`):
[`docs/pipelines.md`](docs/pipelines.md).

## Writing collectors — EQ-Bench and LMArena

Two external leaderboards, both pulled whole, neither judged here:
`src/server/collectors/eqbench.ts` reads the CSV embedded in the EQ-Bench site repo's own
JS (creative writing v3 + longform → `creative_writing_elo`, `creative_writing_rubric`,
`slop_score`, `repetition_score`, `vocab_complexity`, `longform_writing`), and
`src/server/collectors/lmarena.ts` reads LMArena's official leaderboard export off the HF
datasets-server (CC-BY 4.0) for `arena_{elo,creative_writing,german,instruction_following,coding}`.

**The `writing` dimension scores Arena only, with EQ-Bench as a gap-filler** — EQ-Bench's
judge is Claude grading Claude, and its slop score rewards prose that merely reads as
different. `slop_score` and friends are displayed, never scored; both are lower-is-better,
the one inversion on `/benchmarks`. Full argument, and the German gap (nothing public
scores German prose quality): [`docs/decisions/writing-model.md`](docs/decisions/writing-model.md).

The HF datasets-server answers "index is loading" as an HTTP 500 mid-pagination, so the
collector retries and then **keeps the pages it got** — a partial arena pull is incomplete,
never wrong.

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

**It spends real money** (`--yes` required non-interactively; `--dry-run` costs nothing) and
**never remove the isolated `CLAUDE_CONFIG_DIR`** — without it the sandbox loads the global
CLAUDE.md/MCP/hooks and measures dotfiles instead of the model. Five more sharp edges
(parallel-tool-use counting, the CLI's cost figure being Claude-only, golden-solution
graders, `route-map`'s residency check): [`docs/pipelines.md`](docs/pipelines.md).

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
