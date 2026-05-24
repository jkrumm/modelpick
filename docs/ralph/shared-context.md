# modelpick — RALPH Shared Context

You are building **modelpick**: a public, daily-refreshed dashboard that ranks the LLM / TTS / STT
models the user *actually has access to* via the IU unified endpoint, cross-checked against external
leaderboards, plus an interactive audio playground for trialling and curating voice demos.

**Read `PRD.md` in the repo root fully before starting.** It is the source of truth for scope,
decisions, and non-goals. This file adds the operational rules for the autonomous loop.

---

## What modelpick Is

A TanStack Start (full-stack React) app. SSR + static prerender for cheap, cacheable public pages;
server functions for every IU / aggregator call so secrets never reach the client. Three sections in
one shell: **LLM decider**, **TTS playground**, **STT playground**. A daily cron gathers data, writes a
dated snapshot to Postgres, recomputes recommendations, and re-renders the public pages. The decider
uses a transparent weighted score (quality × cost × throughput, filtered to IU-available) plus a short
LLM-written rationale per category.

It is a personal "vibe" project — not production-critical. Favor simple, readable, battle-tested
solutions over cleverness. Stay within the scope of each group; don't sprawl.

## Prior art — READ THESE (they save you live-probing blind)

- `~/SourceRoot/dotfiles/docs/iu-multimodal-exploration.md` — verified IU endpoint capability matrix
  (chat/vision/TTS/STT/image), working model names, the **EU/US data-residency table**, and gotchas
  (STT sniffs filename extension; `dall-e-3` is dead; single-backend models flap 503).
- `~/SourceRoot/dotfiles/docs/sideclaw-multimodal-task.md` — exact request/response shapes for the IU
  OpenAI transport (chat vision, audio, image gen) with curl-verified payloads.
- `~/SourceRoot/argo` — the reference app for the **Mantine + visx** stack. Lift the visx chart
  primitive system (ChartCard / ChartLegend / ChartTooltip / AxisLeftNumeric / AxisBottomDate /
  tokens / useVxTheme) from there in Group 7. Follow `~/.claude/rules/visx-charts.md`.

## Repository Layout (target — you build it out)

```
modelpick/
  PRD.md                     # source of truth
  .env / .env.example        # secrets (.env gitignored, already populated)
  Makefile                   # make up / down / db-up / dev — wraps docker + bun
  docker-compose.dev.yml     # local Postgres (:5433)
  app/ (or src/)             # TanStack Start routes, components, server fns
  app/server/                # server-only: IU client, collectors, scoring, db
  app/charts/                # visx primitives ported from Argo
  drizzle/                   # schema + migrations
  docs/ralph/                # this loop's context + notes (do not ship)
```

## Tech Stack

| Concern | Choice |
|-|-|
| Framework | TanStack Start (full-stack React, SSR + prerender) |
| Runtime / pkg mgr | Bun |
| UI | Mantine |
| Charts | visx (primitives ported from Argo) |
| DB | Postgres + Drizzle ORM |
| Lang | TypeScript (strict — see Group 2) |
| Test | Vitest |
| Lint | (decide in Group 2 — oxlint or eslint, match Argo if reasonable) |

**Verify current versions of TanStack Start / Mantine / visx / Drizzle via WebSearch/WebFetch or
Context7 before pinning. Do NOT assume versions from training data — the ecosystem moves.**

## Secrets — use env vars, never `op run`

All secrets are already resolved into `.env` (gitignored) and **sourced into your environment by the
runner** — they are available as plain env vars. Reference them directly; never call `op`/`op run`
(it would block on Touch ID and stall the loop):

- `IU_API_KEY`, `IU_BASE_URL` (…/anthropic), `IU_OPENAI_BASE_URL` (…/openai/v1) — IU unified endpoint.
- `DATABASE_URL` — local docker Postgres (`postgresql://modelpick:…@localhost:5433/modelpick`).
- `OPENROUTER_API_KEY`, `ARTIFICIALANALYSIS_API_KEY` — external leaderboards.
- `ADMIN_KEY` — the lightweight client-side admin gate (NOT real auth).

The app should load `.env` via the framework's standard mechanism for runtime; tests/scripts inherit
the runner env. Never hardcode keys or hostnames in tracked files; never log secret values.

## Validation Commands (run after every group)

```bash
bun run typecheck   # tsc --noEmit — must be clean
bun run lint        # must be clean
bun run test        # all Vitest tests pass (script must be `vitest run`, never watch)
bun run build       # SSR/prerender build must be clean
```

Group 1 must create these scripts in `package.json`. The runner gates every group (the four above,
build included) and will mark your group failed if any fails — so run all four yourself before you
signal complete.

## Research Before Implementing

1. Explore with Glob/Grep/Read — understand existing patterns (and Argo for charts).
2. Research unfamiliar libraries with WebSearch/WebFetch or Context7 (`bunx -y @upstash/context7-mcp`
   is unavailable in headless; prefer WebFetch of official docs). Verify APIs — don't invent them.
3. Read relevant existing code before writing new code.
4. The group prompt is direction, not prescription — use a better approach if you find one, and note it.

## Learning Notes — ALWAYS append after each group

Append to `docs/ralph/RALPH_NOTES.md`:

```markdown
## Group N: <title>
### What was implemented
### Deviations from prompt
### Gotchas & surprises
### Security notes
### Tests added
### Future improvements
```

## Commit Format — raw git only

Conventional commits, **no AI/tool attribution** (`~/.claude/rules/attribution.md`):
```
feat(<scope>): <description>
```
Stage only the files you changed (`git add <files>`), then `git commit -m "..."`. Commit before
signaling completion.

**Do NOT invoke `/commit`, `/pr`, `/check`, `/review`, `/ship`, or any slash-command skill.** They are
interactive and will silently no-op in headless mode, leaving your work uncommitted and the group
failed. Run validation as raw `bun run typecheck && bun run lint && bun run test`. For multiple logical
commits, repeat `git add <subset> && git commit -m "..."`.

Do not `git push` (a pre-push hook blocks it anyway). Do not commit `.env` or `.ralph-*` artifacts.

## Completion Signal

Output exactly one of these as the **very last line**:
```
RALPH_TASK_COMPLETE: Group N
```
If genuinely blocked:
```
RALPH_TASK_BLOCKED: Group N - <one-sentence reason>
```
