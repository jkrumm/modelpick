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

## Wave 1 — Catalog from the live API            <!-- status: done -->
- [x] `scripts/sync-catalog.ts` (replaces `scripts/import-portal.ts`): fetch the four legs (plus Replicate
      through the existing `import-replicate` path, untouched) and merge by exact id. Record display name,
      vendor→provider, context, a modality derived from capabilities (Embedding→embedding,
      VoiceOutput→tts, VoiceInput/AudioInput-only→stt, ImageGeneration→image, else llm; keep the existing
      decision handling from `src/db/decision-models.ts`), the legs each id is accepted on, and `owned_by`.
      Add schema columns only where needed (`db:push`). Write the committed snapshot
      `src/db/iu-catalog.ts`, upsert, and set `iu_listed=false` on ids that vanished (never delete: probes
      and metrics hang off them). Print an added/removed diff against the previous snapshot.
- [x] Make it step 0 of `bun run refresh` (`src/server/refresh.ts`), and let `src/server/snapshot-commit.ts`
      commit `iu-catalog.ts` alongside `epoch-benchmarks.ts`, keeping the same safety rules.
- [x] Delete `scripts/import-portal.ts`, `src/server/iu/portal.ts` + `portal.test.ts`, and the
      `.claude/skills/update-iu-models/` skill. Update `refresh-stack` and `investigate-models` skill text
      and the AGENTS.md "IU model catalog" section to the new flow.
- [x] Makefile: `make models` (catalog sync), `make probe`, `make collect`, `make refresh`. Each wraps the
      existing bun script. Add them to `.PHONY` and the AGENTS.md targets line.
- [x] Live: `make models` once, record per-leg counts and the diff in Left behind, then `make probe`.
**Left behind:** (2026-10-26)
- `make models` live: 339 models. Legs: OpenAI 332, Anthropic 43, Gemini 42, Decisions 10. By modality: llm 242,
  decision 8, embedding 14, image 24, tts 32, stt 18 (plus `claude-haiku-5-5-eu`). Diff vs the old snapshot:
  +143 added (case variants, `-eu`/Claude 4.x–5.x aliases, Gemini aliases, decisions), -13 vanished (old
  portal-cased ids such as `DeepSeek-V4.1-Flash`, `GPT-5`, `Whisper`; flagged `iu_listed=false`, rows kept).
- `make probe` live: 256 available, 107 not_routed, 38 unknown, 1 timeout (listed ≠ callable); 336 `iu_listed` iu rows.
  `claude-haiku-5-5-eu` probes available.
- Orchestrator note applied: `HIDDEN_CALLABLE` (src/server/iu/catalog.ts, starts with `claude-haiku-5-5-eu`);
  the sync never delists ids referenced by `deployments.ts` / `MY_STACK`, and prints them as "referenced but
  unlisted": `claude-haiku-5-5-eu` (hidden-callable), `claude-sonnet-5[1m]` (Claude Code alias),
  `grok-4.20-reasoning` (external). Documented in AGENTS.md "IU model catalog".
- New columns `models.owned_by`, `models.legs` (`drizzle-kit push --force` done locally; the mini's DB needs the
  same push on `make deploy`: `make db-push`). `MY_STACK` is now exported from `seed.ts`.
- Refresh is now catalog → probe → collect → recommend; `iu-catalog.ts` is committed by the refresh like epoch.
  `make models` also runs `import:replicate`, which rewrites `replicate-catalog.ts` with a pure re-ordering
  (209/209 line churn); I reverted that file, so it is unchanged.
- `make check` green (886 tests). No `/review` gateway run: self-read the diff.
- **Not mine, left alone:** the tree had uncommitted TTS "expression" edits from another session
  (`data/tts-compare/manifest.json`, `src/server/audio/{compare,experiments}.ts`, `src/routes/-tts-workbench.tsx`,
  `src/__tests__/tts-experiments.test.ts`). Wave 2 deletes that code; decide whether to commit or drop them first.

## Wave 2 — Cut the bloat (TTS frozen)            <!-- status: done -->
**TTS freeze (orchestrator, 2026-10-26):** audio-gateway's active Wave 3 ends with the owner picking a podcast
writer in a blind rematch on modelpick `/tts`, and it edits modelpick's TTS files right now (the uncommitted
`data/tts-compare/manifest.json`, `src/server/audio/{compare,experiments}.ts`, `src/routes/-tts-workbench.tsx`,
`src/__tests__/tts-experiments.test.ts` are **its** work: never stage, revert, stash or delete them). Everything
TTS stays untouched in this wave: `tts*` routes, `-tts-*`, `-gemini-tts-docs`, `-audio-server-fns`,
`api.tts-audio.*`, the TTS modules in `src/server/audio/`, `scripts/tts-*`, `data/tts-compare`,
`docs/gemini-tts.md`, the `demo` table if `/tts` reads it, and their tests. Wave 5 removes or moves them
once that rematch has its verdict. `git add` explicit paths only.
- [x] Scripts: delete `adhoc-*`, `benchmark-bakeoff`, `benchmark-crossprovider`, `benchmark-tool-calling`,
      `bench-fast`, `bench-writing`, `bench-review-judge`, `bench-decision`, `stt-compare`, `stt-testset`,
      `seed-demos` (if TTS does not need it), `pick`, `cap`, `route-map`, plus their package.json entries.
      Keep `benchmark-throughput`, which feeds scoring with live speed metrics.
- [x] Server + tests: delete the STT modules of `src/server/audio/` (`stt-compare`, `stt-score`), `bench/{fast-metrics,
      fast-tasks,iu-client,rates,writing-*,review-judge,decision-*}`, `pick/*` except `anthropic.ts`, `iu/index.ts`,
      and the matching tests (fast-metrics, fast-tasks, writing-metrics, review-judge,
      decision-metrics/summary/tasks, stt-coverage, stt-score; shrink `pick.test` to the anthropic cases).
      Check importers first. If a TTS file imports something on this list, keep that thing.
- [x] Routes: delete `stt*`, `-stt-*`, `api.stt-audio.*`, `decision*`, `bench.tsx` + `-bench-server-fns`. Prune
      `NAV_ITEMS`. Fold `index.tsx` ("Decider") into `/stack` or `/catalog` only if it duplicates them.
- [x] Data/docs: `git rm` `data/stt-compare` and `docs/experiments/*`, except anything a `docs/decisions/*`
      file or audio-gateway's PLAN links to (re-point or inline the numbers). Keep `docs/decisions/*`. Update
      AGENTS.md, README, `docs/pipelines.md` and `docs/GUIDELINES.md` wherever they name cut commands.
- [x] `make check` (the foreign uncommitted TTS edits are part of the tree. If they break the check, say so in
      Left behind and do not fix them), then `bun run build`, then a fallow/dead-code pass to catch orphans.
      Record LOC before and after.
**Left behind:** (2026-10-26)
- Source LOC (`src/**`, `scripts/**`): 46,787 → 33,384. `make check` green (743 tests), `bun run build` green,
  fallow dead-code pass done (orphans trimmed: `bench/route.ts` is now just the `RouteResidency` type, `summary.ts`
  re-exports shrunk). No `/review` gateway run: self-read the diff, it is nearly all deletions.
- Cut: scripts `adhoc-*`, `benchmark-{bakeoff,crossprovider,tool-calling}`, `bench-{fast,writing,review-judge,decision}`,
  `stt-{compare,testset}`, `pick`, `cap`, `route-map` (+ package.json entries); `audio/stt-score`, `bench/{fast-*,
  iu-client,rates,writing-*,review-judge,decision-*}`, `pick/*` except `anthropic.ts`, `iu/index.ts`, their tests (`pick.test`
  shrunk to anthropic cases; the `cap` stream-contract test in `bench-summary.test` removed); routes `stt*`, `decision*`,
  `bench*`, `api.stt-audio`; NAV pruned to Stack / Decider / Catalog / Leaderboards / TTS. `/` (Decider) kept: it is the
  interactive weight scorer, not a duplicate of `/stack`/`/catalog`. `data/stt-compare` and `docs/experiments/fast-2026-10-08` removed.
- **Kept on purpose (TTS freeze):** `seed-demos` + `demos:seed` (TTS playground), `scripts/tts-*`, and
  `src/server/audio/stt-compare.ts` + `stt-coverage.test.ts`: `-audio-server-fns.ts` still imports `readStt*`, and its STT
  fns (`getSttPlaygroundData`, `runSttDemoFn`, `getSttCompareFn`) are now dead. Wave 5 removes them with the workbench.
  `docs/experiments/*` kept except the one unlinked run: the rest is linked from `docs/decisions/*` or is ccbench's output dir.
- `docs/decisions/audio-stack.md` STT sources line re-pointed (scripts recoverable from git history).
- **Outside this repo, not touched:** `dotfiles/docs/opencode.md:29` says context windows/prices come from
  `bun run scripts/cap.ts --json --all`, which is gone, and a comment in `agent-gateway/server/mcp/session-runner.ts:1101`
  cites `bun run pick`. Also check that the `cap`/`ca` shell launchers in dotfiles don't call it. Wave 4's STACK.md replaces that source.
- fallow still lists the frozen `scripts/tts-*` files and a pre-existing `src/styles/app.css` as unused.

## Wave 3 — Better sources            <!-- status: active -->
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
- [ ] Only if audio-gateway's rematch wave is `done` (check its PLAN.md): remove the TTS workbench, or move it
      to audio-gateway if the owner still uses it. That covers the routes, `src/server/audio/*`, `scripts/tts-*`,
      `data/tts-compare` and `docs/gemini-tts.md`. Otherwise leave it and say so.
- [ ] Full `make check`, `/review` of the overhaul diff since `97ac178`, fix findings.
- [ ] Delete this PLAN's finished waves (git history keeps them) or replace PLAN.md with a one-line "no active wave".
- [ ] Hand back for `make deploy` + `make verify` (orchestrator runs it).
**Left behind:**
