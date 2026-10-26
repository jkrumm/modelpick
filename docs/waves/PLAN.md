# modelpick overhaul — automatic catalog, better sources, one stack file, half the code
**Goal:** `make models` / `make refresh` keep the IU catalog and the leaderboards current with zero manual
steps; `STACK.md` at the repo root says which model to use for what today; the experiment bloat is gone.
**Gate:** `make check` green; every wave that touches a pipeline also runs that pipeline **live** once and
records the row counts in its Left behind (green tests ≠ working pipeline). **IU spend:** only
`bun run probe` (one tiny call per model, cents) is allowed. Never run `bench`, `bench:*`, `benchmark*`,
`tts-*`, `stt-*` or anything with a model call per task. Before any other paid call, stop and write it into
Left behind.

## Established — do not re-derive

- **The portal HTML export is obsolete.** The IU gateway's per-leg `/models` endpoints return exactly what
  the check-key page shows (verified 2026-10-26: OpenAI 332, Anthropic 43, Gemini 42, Decisions 10). All of
  them use the API key from `.env.tpl` (`IU_API_KEY`), so no SSO is needed:
  - `GET $IU_OPENAI_BASE_URL/models` (Bearer) → `data[]` with `id`, `Human_readable_name`, `Description`,
    `ContextSize` (string), `Vendor`, `Capabilities[]` (ChatCompletion, Functions, ImageInput, AudioInput,
    VideoInput, VoiceInput, VoiceOutput, Embedding, ImageGeneration, ImageOutput, Responses) and `owned_by`.
    `owned_by` is the backend route list (e.g. `Requesty-EU`, `… GDPR`, `IU AI Middleware Sweden Central
    Azure`, `Nebius AI Cloud`). Keep it: it is the best residency hint there is.
  - `GET $IU_ANTHROPIC_BASE_URL/models` (`x-api-key` + `anthropic-version: 2023-06-01`), `GET
    $IU_GEMINI_BASE_URL/models` (`x-goog-api-key`), `GET $IU_DECISIONS_BASE_URL/models` (Bearer) → which
    ids each leg accepts. The legs differ: Luna/DeepSeek/Gemini-flash 404 on the Anthropic leg.
  - ids are case-sensitive and the old portal snapshot used variants (`DeepSeek-V4.1-Flash`, `GPT-5`,
    `Whisper`). Take the API's ids verbatim. Case-only duplicates of a live id disappear.
  - There is **no** spend/usage/key-info API (`/openai/v1/{usage,key/info,spend/logs,…}` → 501). The cost
    side lives in usage-tracker (`~/SourceRoot/usage-tracker/docs/waves/PLAN.md`), not here.
- **Sources research (2026-10-26, research-gateway):**
  - **Keep:** ArtificialAnalysis v2 (the same key also unlocks speech: `GET
    /api/v2/media/text-to-speech/models/free` → elo, ci_95; `GET /api/v2/media/speech-to-text/models/free` →
    `aa_wer_index`; header `x-api-key`), OpenRouter `/api/v1/models` (USD/token decimal strings; drop the
    `"-1"` sentinel, `:free`, `:batch` and `~` aliases), Epoch AI export, LMArena via the HF datasets-server.
  - **Add:** models.dev `https://models.dev/api.json` (provider → models map; `cost.input/output/cache_read`
    in **USD per 1M**; `limit.context`; join through `canonical_model_id`). It becomes the list-price source.
  - **Drop:** the EQ-Bench scrape (Claude-judging-Claude, already display-only, and a JS-embedded CSV).
  - **Do not add:** LiveBench (2.0 has no data endpoint; the v1 CSV is stale), Scale SEAL, Vellum, Aider,
    swebench.com (none machine-readable or current). llm-stats (`api.zeroeval.com`) is undocumented, so skip it.
  - **Verify before relying on it:** the AA spec now shows a `/api/v2/language/models` path family next
    to our `/api/v2/data/llms/models`. Confirm which one is live. The HF Open ASR CSVs returned 401 to the
    researcher; if they are gated, skip them and use AA's `aa_wer_index` for STT.
- **Cut list (Explore inventory 2026-10-26).** The owner asked for a hard slim-down. TTS, STT, decision,
  fast and writing have their verdicts recorded in `docs/decisions/*`, so their code and data go.
  **Keep** the ccbench runner (`bench.ts`, `src/server/bench/{sandbox,spawn,metrics,persist,tasks,report}`,
  `fixtures/`, the isolated `.ccbench-config`): it is the only agent-loop measurement, and
  `bench/summary.ts` (+ `cost,format,models,route,score,types`, `pick/anthropic.ts`) feeds `recommend.ts`
  and `/stack`. Keep `src/server/iu/decision-client.ts` + its test (probe uses it).
- MY_STACK lives in `src/db/seed.ts` and the deployments in `src/db/deployments.ts` (1181 lines,
  verified by `verify-deployments`). Current picks include `deepseek-v4.1-flash` as the estate default
  (Hermes and friends) and Gemini 3.8 TTS (`gemini-3.8-flash-lite-tts` for chat, `gemini-3.8-flash-tts` for
  briefings/podcasts; voices Charon/Erinome). STT is decided in `docs/decisions/audio-stack.md` (Voxtral mini
  default, MacWhisper for dictation).

## Wave 1 — Catalog from the live API            <!-- status: active -->
- [ ] `scripts/sync-catalog.ts` (replaces `scripts/import-portal.ts`): fetch the four legs (plus Replicate
      through the existing `import-replicate` path, untouched) and merge by exact id. Record display name,
      vendor→provider, context, a modality derived from capabilities (Embedding→embedding,
      VoiceOutput→tts, VoiceInput/AudioInput-only→stt, ImageGeneration→image, else llm; keep the existing
      decision handling from `src/db/decision-models.ts`), the legs each id is accepted on, and `owned_by`.
      Add schema columns only where needed (`db:push`). Write the committed snapshot
      `src/db/iu-catalog.ts`, upsert, and set `iu_listed=false` on ids that vanished (never delete: probes
      and metrics hang off them). Print an added/removed diff against the previous snapshot.
- [ ] Make it step 0 of `bun run refresh` (`src/server/refresh.ts`), and let `src/server/snapshot-commit.ts`
      commit `iu-catalog.ts` alongside `epoch-benchmarks.ts`, keeping the same safety rules.
- [ ] Delete `scripts/import-portal.ts`, `src/server/iu/portal.ts` + `portal.test.ts`, and the
      `.claude/skills/update-iu-models/` skill. Update `refresh-stack` and `investigate-models` skill text
      and the AGENTS.md "IU model catalog" section to the new flow.
- [ ] Makefile: `make models` (catalog sync), `make probe`, `make collect`, `make refresh`. Each wraps the
      existing bun script. Add them to `.PHONY` and the AGENTS.md targets line.
- [ ] Live: `make models` once, record per-leg counts and the diff in Left behind, then `make probe`.
**Left behind:**

## Wave 2 — Cut the bloat            <!-- status: pending -->
- [ ] Scripts: delete `adhoc-*`, `benchmark-bakeoff`, `benchmark-crossprovider`, `benchmark-tool-calling`,
      `bench-fast`, `bench-writing`, `bench-review-judge`, `bench-decision`, `tts-compare`, `tts-audition`,
      `tts-wave5`, `stt-compare`, `stt-testset`, `seed-demos`, `pick`, `cap`, `route-map`, plus their
      package.json entries. Keep `benchmark-throughput` (live speed metrics feed scoring).
- [ ] Server + tests: delete `src/server/audio/*`, `bench/{fast-metrics,fast-tasks,iu-client,rates,writing-*,
      review-judge,decision-*}`, `pick/*` except `anthropic.ts`, `iu/index.ts`, and the matching tests
      (fast-metrics, fast-tasks, writing-metrics, review-judge, decision-metrics/summary/tasks, audio,
      stt-coverage, stt-score, tts-experiments; shrink `pick.test` to the anthropic cases). Check whether
      `rates.ts` has non-cut importers first.
- [ ] Routes: delete `tts*`, `stt*`, `-tts-*`, `-stt-*`, `-gemini-tts-docs`, `-audio-server-fns`,
      `api.*-audio.*`, `decision*`, `bench.tsx` + `-bench-server-fns`. Prune `NAV_ITEMS`. Fold `index.tsx`
      ("Decider") into `/stack` or `/catalog` if it duplicates them; otherwise leave it. Drop the `demo`
      table and its queries (`bunx drizzle-kit push --force`).
- [ ] Data/docs: `git rm` `data/tts-compare`, `data/stt-compare`, `docs/gemini-tts.md`,
      `docs/experiments/*` except anything a `docs/decisions/*` file links to (re-point or inline the
      numbers). Keep `docs/decisions/*`. Update AGENTS.md, README, `docs/pipelines.md` and
      `docs/GUIDELINES.md`, which still name the cut commands.
- [ ] `make check`, then `bun run build` and a fallow/dead-code pass (`/analyze` or `bunx fallow`) to catch
      orphans the cut left behind. Record LOC before/after.
**Left behind:**

## Wave 3 — Better sources            <!-- status: pending -->
- [ ] Add a `modelsdev` collector (`src/server/collectors/`): list prices (in/out/cache per 1M) and
      context into `metric_snapshot`, joined to catalog ids (exact id → canonical id → normalised slug; log
      unmatched ids). Make it the preferred list-price source in scoring; OpenRouter becomes the fallback.
      Measured IU rates (`price_*_per_m` from `usage.cost`) still win over both.
- [ ] Add AA speech: TTS elo/ci and STT `aa_wer_index` from the `/free` endpoints into `metric_snapshot`,
      and wire them into the `tts`/`stt` category weights in `score.ts`. Confirm which AA LLM path family
      is live and migrate if `/data/llms/models` is deprecated.
- [ ] Remove the EQ-Bench collector, its metrics in `/benchmarks` formatting, and its writing gap-filler
      role. Writing scores Arena only. Update `docs/decisions/writing-model.md` in one line.
- [ ] Re-verify the LMArena HF dataset still carries current models (the arena site moved to agent
      win-shares; the dataset may have changed shape).
- [ ] Live: `bun run collect`; record rows per source and confirm no source is degraded. Then `bun run
      recommend` and note any category whose pick changed, with the reason.
**Left behind:**

## Wave 4 — STACK.md, the one file that says what to use            <!-- status: pending -->
- [ ] Move `MY_STACK` out of `seed.ts` into `src/stack.ts` (seed imports it). One entry per job the owner
      actually has: estate default/fast (Hermes, gateways), coding, orchestrator, writing, TTS chat, TTS
      long-form, STT, embedding, vision, image, decision. Each gets model id, reasoning effort / settings,
      the IU leg it runs on, a one-line why, and its decision-record link.
- [ ] `make stack` renders `STACK.md` at the repo root from `src/stack.ts` + `deployments.ts`, then
      metric_snapshot. One table: job → model → settings → $/1M in/out (models.dev or measured) → where it
      runs (deployment slots) → drift flag from the latest recommendation. A test fails when the
      committed `STACK.md` is stale relative to `src/stack.ts`.
- [ ] AGENTS.md: point "current picks" at `STACK.md`. Shrink AGENTS.md: move the ccbench and pipeline
      detail to `docs/pipelines.md`, so AGENTS.md keeps decisions, commands and traps only.
**Left behind:**

## Wave 5 — Close            <!-- status: pending -->
- [ ] Full `make check`, `/review` of the overhaul diff since `97ac178`, fix findings.
- [ ] Delete this PLAN's finished waves (git history keeps them) or replace PLAN.md with a one-line "no active wave".
- [ ] Hand back for `make deploy` + `make verify` (orchestrator runs it).
**Left behind:**
