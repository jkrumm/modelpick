# Group 1: Scaffold & foundation

## What You're Doing

Stand up the modelpick skeleton so every later group has a compilable, testable base. A TanStack Start
(full-stack React) app on Bun with Mantine, a shared app shell with three stub routes (decider / TTS /
STT), a local Postgres via docker-compose, a Makefile, and the `package.json` validation scripts the
runner depends on. No real features yet — just a clean, green foundation. **No validation gate runs
before this group; you must leave it green.**

## Research & Exploration First

1. Read `PRD.md` and `docs/ralph/shared-context.md` fully.
2. **Verify the current TanStack Start scaffolding + version** via WebFetch of the official docs
   (tanstack.com/start). Do not assume the CLI name or config shape from memory.
3. Look at `~/SourceRoot/argo` for how Mantine is wired (provider, theme, vite/tsconfig) — mirror what
   fits, don't copy wholesale.
4. Confirm Bun + Vitest integration for a TanStack Start app.

## What to Implement

1. **TanStack Start app** (SSR-capable) with Bun. Three routes rendering placeholders:
   `/` (Decider), `/tts` (TTS playground), `/stt` (STT playground).
2. **App shell**: Mantine provider + a top nav (tabs/links) shared across routes. Dark/light aware.
3. **`package.json` scripts** (exact names — the runner calls them):
   `dev`, `build`, `typecheck` (`tsc --noEmit`), `lint`, `test` (vitest). `lint` may be a placeholder
   that exits 0 until Group 2 sets up the real linter — but it MUST exist and pass.
4. **Vitest** config + one trivial passing test (e.g. a util) so `bun run test` is green.
5. **`docker-compose.dev.yml`**: a Postgres service on host port **5433**, using `POSTGRES_USER`,
   `POSTGRES_PASSWORD`, `POSTGRES_DB` from env (the runner sources `.env`).
6. **`Makefile`**: `db-up` (compose up postgres -d), `db-down`, `dev` (bun run dev), `build`,
   `up` (db-up then dev), `down`. Wrap docker via compose; no raw docker in docs.
7. **README.md**: one-paragraph what-it-is + `make up` quickstart + `.env.example` pointer.
8. **`.env` loading**: ensure the app reads env at runtime (framework standard). Don't commit `.env`.

## Validation

```bash
bun install
bun run typecheck   # clean
bun run lint        # clean (placeholder ok this group)
bun run test        # the trivial test passes
bun run build       # builds clean
```

## Commit

```
feat(scaffold): TanStack Start + Mantine shell, local pg, validation scripts
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 1
```
