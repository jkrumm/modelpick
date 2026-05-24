# modelpick

A public, daily-refreshed dashboard that ranks the LLM / TTS / STT models accessible via the IU
unified endpoint, cross-checked against external leaderboards, plus an interactive audio playground
for trialling and curating voice demos.

## Quick start

```bash
cp .env.example .env
# fill in .env values (or resolve from 1Password)
make up
```

The app runs at `http://localhost:3001`. Postgres runs on port 5433.

## Development

```bash
make db-up   # start local Postgres
make dev     # start dev server (or: bun run dev)
make down    # stop everything
```

## Env

See `.env.example` for required variables. Copy to `.env` and fill in values. The `.env` file is
gitignored — never commit real keys.

## Validation

```bash
bun run typecheck   # TypeScript
bun run lint        # linting
bun run test        # Vitest unit tests
bun run build       # SSR build
```
