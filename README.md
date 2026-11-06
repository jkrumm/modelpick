# modelpick

A local data server for model choice: it collects the models accessible via the IU unified endpoint,
external leaderboard data and live access probes, and serves ArtificialAnalysis efficiency data at
`GET /api/efficiency` (Argo renders it at `/models`). It also hosts the TTS playground (`/tts`) for
trialling and curating voice demos.

What every service actually runs is `agw routes` (agent-workflows), not this repo.

Single-user, local-only. State lives in one SQLite file (`modelpick.db`, gitignored).

## Start here

| | |
|-|-|
| **[docs/GUIDELINES.md](docs/GUIDELINES.md)** | The settled patterns: choosing a model, configuring it, measuring one, recording the decision. Start here. |
| **[docs/decisions/model-configs.md](docs/decisions/model-configs.md)** | The rollout reference: exact settings per model per wire, which gateway leg serves what, and the traps. |
| [docs/decisions/](docs/decisions/) | The evidence behind each pick, with a current-verdict block at the top of every record. |
| `GET /api/efficiency` | Per-effort intelligence, cost and speed, plus the agw routes mapped onto them (Argo relays it). |
| `/tts` | The TTS playground. |

## Quick start

```bash
make db-push             # create the SQLite schema from src/db/schema.ts
make db-seed             # seed the model catalogs
make dev                 # start the dev server
```

The server runs at `http://localhost:7727` (also `https://modelpick.test` via the dotfiles Caddyfile).
No `.env` file needed — secrets resolve via `secrets-run` at runtime (see Env below): the `op` CLI
(account `tkrumm`) on the MacBook, an offline cache on the headless mini.

## Running the agentic bench

```bash
bun run bench        # run the agentic ccbench suite that measures operational fitness of coding models (spends; --dry-run is free)
```

## Database

A single local SQLite file via libsql — no docker, no server. The schema is the source of truth in
`src/db/schema.ts`; `make db-push` (`drizzle-kit push`) syncs it to `modelpick.db`. There is no
migration folder — change the schema, re-run `db:push`. Override the location with
`DATABASE_URL=file:/abs/path.db`.

```bash
bun run db:push     # sync schema → modelpick.db
bun run db:seed     # model catalogs
bun run demos:seed  # audio demos
```

## Daily refresh

Run the full pipeline (catalog → probe access → collect external metrics → release alerts) locally:

```bash
bun run refresh
```

On the mini it runs daily at 06:00 as the `com.jkrumm.modelpick-refresh` LaunchAgent
(`launchd/*.plist.template`): `make refresh-setup` installs it, `make refresh-check` reports
the last exit, `make refresh-teardown` removes it. Logs: `~/Library/Logs/modelpick-refresh.{log,err}`.

Individual steps: `bun run probe`, `bun run collect`, `bun run alerts`.

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

Scripts run through `scripts/with-keys`. On the mini, when the inference gateway issued a
`modelpick=` door token (`~/.agent-workflows/data/door-tokens`), the wrapper points `IU_API_KEY` and
the five IU base URLs at the gateway on `127.0.0.1:7794` through a 0600 override file; without the
token `.env.tpl` is what runs.

Run a one-off script manually:

```bash
scripts/with-keys bun run scripts/probe.ts
```
