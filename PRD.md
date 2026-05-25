# modelpick — PRD

> Pick the best model per job. A public, daily-refreshed dashboard that ranks the LLM / TTS / STT
> models *you actually have access to* (IU unified endpoint), cross-checked against external
> leaderboards, plus an interactive audio playground for trialling and curating voice demos.

Status: built. Author: Johannes. Date: 2026-05-24. Public GitHub repo `modelpick` (`master`).
Vibe project — not production-critical.

> **Pivot (2026-05-25):** dropped the original VPS/Postgres/RollHook deploy trajectory. modelpick
> is now **local-only** — a single SQLite file (`modelpick.db`), run on the Mac, no docker, no CI,
> no public hosting. The persistence/deploy details below are superseded by this note; the product
> vision and decider/scoring design still hold.

---

## Problem

Choosing which model to use for a given job (fast helper, coding worker, orchestrator, TTS, STT) is a
moving target. Leaderboards live across ~20 fragmented sites; none of them tell you *which models you
can actually reach* through the IU unified endpoint, nor reconcile public quality rankings with your
real cost/latency. Audio is worse: which TTS/STT models the IU key serves is empirical trial-and-error,
and there's no single place to A/B-listen to candidate voices in German + English.

modelpick collapses this into one daily-refreshed app: ground-truth IU catalog × external rankings ×
your own criteria → a clear recommendation per category, with charts and an audio demo gallery.

## Goals

1. **Ground truth = IU access.** Live-probe the IU unified endpoint to know exactly which chat / TTS /
   STT / vision / image models respond for your key, with latency, backend redundancy, and EU/US
   data-residency — the same probing already proven in `dotfiles/docs/iu-multimodal-exploration.md`.
2. **Unified shell, three sections from day one:** LLM decider, TTS playground, STT playground. Shared
   model catalog, criteria filters ("IU-available only" toggle), and model cards across all three.
3. **Decider per category** — fast / coding / orchestrator (TTS and STT too) via a transparent weighted
   score (quality × cost × throughput, your adjustable weights), filtered to IU-available, with a short
   LLM-written rationale per pick.
4. **External cross-check without scraping.** Pull structured rankings/pricing from aggregator APIs
   (OpenRouter; artificialanalysis if it exposes an API) and normalize into one schema alongside the IU
   catalog. No fragile HTML scraping in v1.
5. **Daily refresh.** A local run gathers data and writes a dated snapshot to SQLite. Trend charts
   read the snapshot history.
6. **Model news** — surface notable *reasonable* new model releases (filtered, not a firehose).
7. **Audio demos as static assets.** Public users hear *pre-computed* TTS/STT demos served as static
   audio (no IU token spend, no key exposure on the public path). Admin (you) can generate fresh demos
   live, configure texts/emotions, and curate which demos appear publicly.
8. **Charts** reuse the Argo visx primitive system (ChartCard / ChartLegend / ChartTooltip / axes /
   tokens) — consistent, theme-aware, no raw hex.
9. **One-command local bring-up** (`make db-push && make db-seed && make dev`).

## Non-goals

- No voice cloning, no custom-voice training (explicitly out — generic-but-good voices only).
- No HTML scraping of leaderboard sites in v1 (APIs + curated seed only; revisit later).
- No real auth / user accounts — admin gate is a lightweight client-side key (localStorage/cookie),
  not a security boundary. Nothing on the public path spends IU tokens, so abuse surface is minimal.
- No tool-aware coding recommendations in v1 (Claude Code→Anthropic / Codex→OpenAI / Antigravity→Google
  / OpenCode→best). Generic fast/coding/orchestrator categories only; tool-aware view is a later add.
- Not a production-critical service — best-effort uptime, simple ops.

## Technical Approach (WHAT, not prescriptive HOW)

- **Stack:** TanStack Start (full-stack React) — SSR + static prerender for the public, cacheable pages;
  server functions for all IU/aggregator calls so secrets never reach the client. **Mantine** UI +
  **visx** charts, lifting the chart primitive system and design tokens from **Argo** (see
  `~/SourceRoot/argo`). Verify current TanStack Start / Mantine / visx versions via `/research` before
  pinning — don't assume.
- **Secrets:** IU key + base via 1Password (`op://common/anthropic`, account `tkrumm`), injected with
  `op run` into the server process — same pattern as Argo. No keys/hostnames in tracked files; the
  OpenAI base is derived from the Anthropic base (`…/anthropic` → `…/openai/v1`), per the memos.
- **Data sourcing:** server-side collectors normalize three sources into one model schema —
  (a) **IU live catalog/probe** (ground truth: access + latency + residency), (b) **OpenRouter API**
  (rankings/pricing/context), (c) **artificialanalysis API** (quality/speed/price — confirmed to exist:
  `artificialanalysis.ai/api-reference`). A `source` + `confidence` field per metric; never trust a
  single source. Keys: `op://vps/modelpick` (resolved at runtime via `op run`).
- **Persistence:** **local SQLite** (`modelpick.db` via libsql), schema synced with `drizzle-kit
  push` from `src/db/schema.ts`. No migration folder, no DB server.
- **Daily refresh:** a local job (`bun run refresh`) runs the collectors, writes a dated snapshot,
  recomputes scores + recommendations, and generates/refreshes the LLM rationale blurbs. Snapshots
  give the trend charts their history.
- **Recommender:** deterministic weighted score over normalized metrics
  (`score = w_quality·Q + w_cost·C + w_speed·S`, weights adjustable in the UI), filtered to
  IU-available; a cheap fast model (e.g. `gpt-4o-mini` / `claude-haiku-4-5-eu`) writes a 1–2 sentence
  "why this one" per category. The score is the decision; the LLM only narrates.
- **Audio pipeline:** admin generates demos via server functions → IU TTS/STT → audio stored as static
  assets (object storage or a served volume) + a `demo` row (text, model, emotion/preset, public flag).
  Public playground reads only the curated static demos. EU-residency respected per the memo (Azure
  Sweden `tts`/`tts-hd`/`whisper` for anything voice-sensitive; US-vendor models flagged).
- **Deploy:** none — runs locally (`make dev`). Superseded by the pivot note above.

## Capability probe — seed inventory (verified 2026-05-22, re-confirm live)

From `dotfiles/docs/iu-multimodal-exploration.md` — the probe should confirm these and discover newer
ones (the catalog drifts). Residency is the deciding factor for audio.

- **Chat (LLM):** `Kimi-K2.6` (EU, coding default), `gpt-5.5` (EU, Sweden), `gemini-3-pro/flash-preview`,
  `claude-{opus-4-7,sonnet-4-6,haiku-4-5}` (+ `*-eu` GDPR aliases), `GLM-5`, `DeepSeek-V3.2`,
  `Qwen3-Coder-480B`, `MiniMax-M2.5`. Backend redundancy + EU/US per `/iu-endpoint`.
- **TTS:** `tts`, `tts-hd` (**EU**, Azure Sweden — stock voices), `gpt-4o-mini-tts`, `gpt-audio*`,
  `gemini-*-tts`, `voxtral-mini-tts` (Mistral). German nativeness is a key eval axis — probe must
  capture accent quality, not just "supports German".
- **STT:** `whisper` (**EU**), `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`,
  `gpt-4o-transcribe-diarize` (diarization — US), `voxtral-mini-transcribe`. Trade-off axis: speed vs WER.
- **Gotchas (carry forward):** STT sniffs the *filename* extension (use `.mp3`, not `.bin`); `dall-e-3`
  is dead (`410`) — irrelevant here but image gen exists if ever wanted; single-backend models (`gpt-5.5`)
  flap `503` — retry with backoff.

## Surfaces / Features

- **Home / Decider:** category cards (fast / coding / orchestrator / TTS / STT) each showing the current
  pick, the score breakdown, the LLM rationale, and runners-up. Weight sliders re-rank live. Top filter:
  "IU-available only", residency (EU/US), price ceiling.
- **Catalog:** sortable/filterable table + model detail cards (metrics, sources, residency, IU access
  badge, trend sparkline). The shared model-card component used everywhere.
- **Charts:** quality-vs-price scatter, throughput bars, trend-over-time lines — all via the Argo visx
  primitives (theme-aware).
- **TTS playground:** demo gallery (static audio), grouped by model; A/B compare 1..N models on the same
  text/emotion preset; German + English presets. Admin controls (gated) to generate + curate demos.
- **STT playground:** static sample transcriptions per model (accuracy/latency side-by-side); admin can
  upload a clip and run it across models live.
- **News:** curated feed of notable reasonable new releases.

## Success Criteria

1. `make up` brings the full stack to life locally (DB + app, secrets via op) in one command.
2. The IU probe correctly reports which LLM/TTS/STT models respond for the key, with latency + residency.
3. Decider returns a defensible pick per category, IU-filtered, with a readable rationale; weight
   sliders change the ranking live.
4. External rankings (≥1 aggregator API) are normalized and visible alongside IU ground truth.
5. Public site is fully usable without spending IU tokens (static demos, cached pages); admin gate
   unlocks live generation + curation.
6. Daily cron writes a snapshot and the trend charts reflect history across days.
7. Runs locally (`make dev`) off a single SQLite file; charts/theming match Argo's quality bar.

## Secrets / env (resolved at runtime — see `.env.tpl`)

No plaintext `.env`. `.env.tpl` (tracked) holds `op://` references; scripts wrap their command in
`op run --account tkrumm --env-file=.env.tpl`, so secrets are injected into the process, never disk.

- `IU_API_KEY` — `op://common/anthropic`. The IU base-URL routes are non-secret config in `.env.tpl`.
- `OPENROUTER_API_KEY`, `ARTIFICIALANALYSIS_API_KEY`, `ADMIN_KEY` — `op://vps/modelpick`.
- `DATABASE_URL` — optional libsql file URL; defaults to `file:modelpick.db` in the repo root.

## Open questions (resolve during implementation)

- Static audio host: resolved — local files under `public/demos/` (gitignored), served directly.
- German-accent quality is subjective — define a fixed eval text + a small rubric the admin scores once
  per model so the "native German" axis isn't hand-wavy.
