# modelpick — Project Instructions

## What this is

modelpick is a **data server** for model choice, plus the **TTS playground** (`/tts`). It collects
the models reachable through the **IU unified endpoint**, external leaderboard data
(ArtificialAnalysis, models.dev, OpenRouter, Epoch AI, LMArena) and live access probes, and serves
per-effort efficiency data at `GET /api/efficiency` (and liveness at `GET /api/health`).

**The decision surface is Argo `/models`**, which renders by relaying `/api/efficiency`; modelpick
has no other UI. The **central model config is agent-workflows** (`agw routes`); a new pick means
changing its route table, not this repo. There is no recommender, "my stack" table or deployment
table any more (removed 2026-11-06). Rationale for past picks stays in `docs/decisions/`.

Local-only, one-person curation. All state lives in a single SQLite file (`modelpick.db`, gitignored).

## Stack

- **TanStack Start** (React 19, SSR) — routes in `src/routes/`. Server routes
  (`api.efficiency.ts`, `api.health.ts`, `api.tts-audio.$name.ts`) are the data API; the TTS page
  uses `createServerFn` in `-audio-server-fns.ts`. `/` redirects to `/tts`.
- **Mantine** UI for the TTS playground only (no charts).
- **Drizzle ORM + local SQLite** (libsql, `@libsql/client`), schema in `src/db/schema.ts`.
  The driver (`drizzle-orm/libsql`) runs under both node (the SSR server) and bun (the scripts).
- **Secrets via 1Password** — no plaintext `.env`. `.env.tpl` (tracked) holds `op://` refs; the
  secret-needing scripts wrap their command in `scripts/with-keys` (→ `secrets-run run --env-file=.env.tpl`), the
  machine-role-aware shim that resolves the backend from `~/.config/secrets/backend` (cache on
  the headless mini, `op` on the MacBook) — a raw `op run` hangs on the mini since `op` isn't
  interactively signed in there. IU key in `op://common/anthropic`, leaderboard keys in
  `op://vps/modelpick`.
- **Local inference gateway (mini)** — package scripts go through `scripts/with-keys`, which runs
  `secrets-run run --env-file=.env.tpl` and, when `~/.agent-workflows/data/door-tokens` has a
  `modelpick=` line, appends a 0600 override (`~/.local/state/modelpick/gateway.env`) with
  `IU_API_KEY` = that door token and the five `IU_*_BASE_URL` on `http://127.0.0.1:7794`. Elsewhere
  `.env.tpl` is what runs. Every probe/catalog request carries `x-agw-upstream: iu` so the Anthropic
  leg measures IU, never a credit org.
- **Make**: `make help` lists the targets; `make check` is the gate.

## Decision models
`decision` is a model modality: typed-answer classifiers with no leaderboard, never probed with a chat "hi". Ids, the systemone route, wire formats and the record: `.claude/rules/decision-models.md` (loads on `src/db/decision-models.ts`, `scripts/probe.ts`, `src/server/iu/**`).

## Model choice and configuration — read the guidelines, don't re-derive

**[`docs/GUIDELINES.md`](docs/GUIDELINES.md) is the settled-patterns surface** — how to choose a
model, how to configure it, how to measure one, how to record the decision. It is short and it
is current; the dated evidence sits behind it in `docs/decisions/`.
**[`docs/decisions/model-configs.md`](docs/decisions/model-configs.md)** is the rollout
reference: exact settings per model per wire, plus the gateway traps.

**Model choice rests on third-party benchmarks** (ArtificialAnalysis, Epoch AI, LMArena, models.dev,
OpenRouter) **plus a live access probe** (`make probe`). We run no evals of our own (owner decision,
2026-11-17). A probe proves a route answers, never that a model is good.

The four facts that decide most questions before they are asked:

- **`gpt-5.6-luna`, `deepseek-v4.1-flash` and `gemini-3.8-flash` 404 on the Anthropic leg.**
  Claude Code (and so every job on the `claude` harness) can only run Anthropic-leg
  ids. Routes on the OpenAI leg (OpenCode harness) reach `deepseek-v4.1-flash` and the other
  OpenAI-route ids. Which model each route uses: `agw routes`. GLM is retired from routing (2026-09-23).
- **Thinking is the quality lever, not overhead.** Luna runs 16.8 at `none` to 37.5 at `max`.
  Set the effort explicitly — `glm-5.3-flash` defaults to `max`, which is its worst setting.
- **When a call returns empty, raise the budget before lowering the effort.** Unused budget is
  not billed. An under-budgeted reasoning model returns HTTP 200 with empty content and
  `finish_reason: length`, silently.
- **Match the metric to the job.** A score whose name matches the question is not evidence that
  it measures the question — that error has produced three wrong answers here.

Past verdicts and raw runs: `docs/decisions/` and `docs/experiments/`.


## Validate

`make check` is the local gate — typecheck, lint and test, non-zero if any fails, no side
effects. Individually: `bun run typecheck` (tsr generate + tsc), `bun run lint` (oxlint),
`bun run test` (vitest), `bun run build` (SSR build). Validate via `/check` before claiming
done.

## Deploy

`make deploy` ships the merged default branch on the mini by wrapping the two install flows.
Both are dev-host only: they assert `~/.config/secrets/backend` is `cache` and refuse to run
elsewhere.

- `make web-setup` builds, then installs/loads the `com.jkrumm.modelpick-web` LaunchAgent on
  :7727, behind the existing Caddy entry (`modelpick.test` → `modelpick.mini.jkrumm.com`).
- `make refresh-setup` installs/loads the 06:00 `com.jkrumm.modelpick-refresh` agent.
- **After pulling schema changes run `make db-push` before `make models` / `make refresh`.**
  Neither pushes the schema itself: `drizzle-kit push` can stop at an interactive prompt
  (column renames, data-loss statements) and the unattended 06:00 agent has no TTY, so it
  would hang. A missing column (e.g. `models.legs`) fails the catalog step instead.
- `project.yaml` is the factory manifest (`deploy.mode make`, target `mini`, ship by push).
  `make version` prints the commit sha that `web-setup` / `web-restart` stamped into
  `~/.local/state/modelpick/deployed-sha`; it exits 1 until a deploy has run.
- `make web-restart` rebuilds and kickstarts the web agent without re-rendering the plist;
  `make web-teardown` / `make refresh-teardown` unload and remove the respective agent.

## Verify & Monitor

- **Health URL** `http://localhost:7727/api/health` (loopback), returns `{"ok":true,"capturedAt":…}`
  from SQLite, so a 200 proves server + DB path together. `make verify` wraps `make web-check`,
  which polls it and matches `"ok":true` — a stray `vite dev` on 7727 also answers 200, so a
  status check alone is not enough. `/api/efficiency` is the Argo feed; its `agw` lookup needs
  `~/.local/bin` (the web plist PATH has it, and `agw-routes.ts` tries that path first).
- **Kuma monitor** `none` — no Uptime Kuma monitor is defined in this repo, and the monitor
  list lives outside it; nothing is claimed here.
- **OTel `service.name`** `none` — modelpick has no OpenTelemetry instrumentation (the `otel`
  agw route is a route slot, not a tracer).
- **Logs** `~/Library/Logs/modelpick-web.{log,err}` and `modelpick-refresh.{log,err}`.
  `make logs` tails the last lines of each and exits (bounded, no `-f`); `make refresh-check`
  reports the refresh agent's last exit.

## Gotchas

- **LaunchAgent, not a Docker container** — deliberate, unlike rb and linewatch. Those own
  their SQLite file exclusively; modelpick's is shared with a host-side writer that cannot be
  containerised (the 06:00 refresh agent). A Docker volume gives two divergent databases; a
  bind mount gives the fcntl/virtiofs corruption already measured twice here (linewatch
  2026-07-30, work dashboard 2026-07-21/26). Same-host processes get real SQLite locking; a
  VM boundary does not.
- **No plaintext `.env`** — `secrets-run run --env-file=.env.tpl` resolves keys; a raw
  `op run` hangs on the headless mini (cache backend there, `op` on the MacBook).
- **`db:push` refuses data-loss statements interactively** — dropping a column needs
  `bunx drizzle-kit push --force`.
- **This repo is public and ArtificialAnalysis data is internal-use only.** Never commit AA API rows, dumps or
  tables (fixtures, docs, snapshots); test fixtures use invented numbers (`fixtures/aa/README.md`).
- **Don't start long-lived servers** — the owner runs dev servers manually; use `make verify`
  against the running instance.

## Efficiency data and release alerts (detail: [`docs/pipelines.md`](docs/pipelines.md))
`GET /api/efficiency` is the Argo feed. Tables, coding evidence, the estimates caveat, the ArtificialAnalysis terms and release alerts: `.claude/rules/efficiency.md` (loads on `src/server/efficiency/**`, `src/server/alerts/**`, `src/routes/api.efficiency.ts`). The field contract is `src/server/efficiency/types.ts`: a change to a field lands in Argo too.

## Database / schema changes
`src/db/schema.ts` is the single source of truth: no migration folder, synced with `bun run db:push`, never hand-written SQL. Dropping a column needs `--force` (see Gotchas). Conventions: `.claude/rules/database.md` (loads on `src/db/**`).

## IU model catalog — how it stays current
Listed ≠ callable: `make probe` proves access. How `make models` syncs the IU legs, `iu_listed` and `HIDDEN_CALLABLE`: `.claude/rules/iu-catalog.md` (loads on `scripts/sync-catalog.ts`, `src/server/iu/**`, `src/db/iu-catalog.ts`).

## Pipelines (detail: [`docs/pipelines.md`](docs/pipelines.md))

- `make refresh` = catalog → probe → collect (+ `aa_variant` upsert) → release alerts, daily 06:00 on the mini
  (`make refresh-check` shows the last exit). A collector that fails or returns 0 rows is a
  *degraded source*: siblings still persist, the run exits 1. **Green tests ≠ working
  pipeline — run the changed pipeline live.**
- Collectors: models.dev (list prices; preferred), OpenRouter, ArtificialAnalysis (+ speech lists),
  Epoch AI, LMArena (writing scores Arena only). Per-source detail in `docs/pipelines.md`.
- `snapshot-commit.ts` commits only the regenerated `epoch-benchmarks.ts`, `iu-catalog.ts`
  and never fails the refresh.
- `make probe` measures access and billing, **not quality**. Quality comes from third-party
  leaderboards only; never read a probe as a benchmark.

## Project skills

The skills live in `.claude/skills/` and load only inside this repo. **Proactively suggest
them** when the situation matches — I rarely remember to invoke them by name:

- **`/investigate-models`** — analyze catalog + metrics to recommend the optimal model for a
  use-case from `/api/efficiency`, `metric_snapshot` and `agw routes`. Trigger when I ask "which
  model for X", "is there something better for Y", or to review the routes.

## Conventions

- TypeScript strict, no `any`. Throw/propagate errors. Typed object args.
- Fix errors only in files you change; don't refactor untouched code.
