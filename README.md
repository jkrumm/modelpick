# modelpick

A local dashboard that ranks the LLM / TTS / STT models accessible via the IU unified endpoint,
cross-checked against external leaderboards, plus an interactive audio playground for trialling and
curating voice demos. It records the models I have actually committed to (My Stack) and flags drift
when the algorithm prefers a different pick.

Single-user, local-only. State lives in one SQLite file (`modelpick.db`, gitignored).

## Quick start

```bash
make db-push             # create the SQLite schema from src/db/schema.ts
make db-seed             # seed the model catalog + My Stack
make dev                 # start the dev server
```

The app runs at `http://localhost:3001`. No `.env` file needed — secrets resolve from 1Password at
runtime (see Env below). You must be signed into the `op` CLI (account `tkrumm`).

## Database

A single local SQLite file via libsql — no docker, no server. The schema is the source of truth in
`src/db/schema.ts`; `make db-push` (`drizzle-kit push`) syncs it to `modelpick.db`. There is no
migration folder — change the schema, re-run `db:push`. Override the location with
`DATABASE_URL=file:/abs/path.db`.

```bash
bun run db:push     # sync schema → modelpick.db
bun run db:seed     # models + My Stack
bun run demos:seed  # audio demos
```

## Daily refresh

Run the full pipeline (probe access → collect external metrics → recommend → news) locally; schedule
it with a LaunchAgent / cron if you want it daily:

```bash
bun run refresh
```

Individual steps: `bun run probe`, `bun run collect`, `bun run recommend`, `bun run news`.

## Validation

```bash
bun run typecheck   # TypeScript
bun run lint        # linting
bun run test        # Vitest unit tests
bun run build       # SSR build
```

## Env

Secrets resolve from 1Password at runtime — there is **no plaintext `.env`**. `.env.tpl` (tracked)
holds `op://` references; the `dev`/`refresh`/`probe`/… scripts wrap their command in
`op run --account tkrumm --env-file=.env.tpl`, so keys are injected into the process and never rest
on disk. IU key lives in `op://common/anthropic`, the leaderboard/admin keys in `op://vps/modelpick`.

Run a one-off script manually:

```bash
op run --account tkrumm --env-file=.env.tpl -- bun run scripts/probe.ts
```
