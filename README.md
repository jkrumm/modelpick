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

The app runs at `http://localhost:7727` (also `https://modelpick.test` via the dotfiles Caddyfile).
No `.env` file needed — secrets resolve via `secrets-run` at runtime (see Env below): the `op` CLI
(account `tkrumm`) on the MacBook, an offline cache on the headless mini.

## Picking a model without the UI

```bash
cap --list          # print the whole recommendation table
cap                  # pick a model from measured data, then launch `ca` with it
bun run bench        # run the agentic ccbench suite that backs the coding-model pick
```

`cap`/`bun run route-map` read only the local SQLite file — no key, no network, nothing spent.

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

Run the full pipeline (probe access → collect external metrics → recommend) locally:

```bash
bun run refresh
```

On the mini it runs daily at 06:00 as the `com.jkrumm.modelpick-refresh` LaunchAgent
(`launchd/*.plist.template`): `make refresh-setup` installs it, `make refresh-check` reports
the last exit, `make refresh-teardown` removes it. Logs: `~/Library/Logs/modelpick-refresh.{log,err}`.

Individual steps: `bun run probe`, `bun run collect`, `bun run recommend`.

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
`secrets-run run --env-file=.env.tpl`, so keys are injected into the process and never rest
on disk. The shim resolves the backend from `~/.config/secrets/backend` (`op` on the MacBook, an
offline cache on the headless mini — a raw `op run` hangs there since `op` isn't interactively
signed in). IU key lives in `op://common/anthropic`, the leaderboard keys in
`op://vps/modelpick`.

Run a one-off script manually:

```bash
secrets-run run --env-file=.env.tpl -- bun run scripts/probe.ts
```
