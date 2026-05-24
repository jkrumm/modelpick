# Group 4: IU capability probe

## What You're Doing

Build the **ground-truth** layer: a server module that probes the IU unified endpoint to discover which
LLM / TTS / STT models actually respond for the user's key, with latency, backend redundancy, and EU/US
data residency, and records results into `capability_probe`. This is the live re-confirmation of the
TTS/STT discovery the user wants — done empirically, not from a stale list.

## Research & Exploration First

1. **Read `~/SourceRoot/dotfiles/docs/iu-multimodal-exploration.md` and
   `~/SourceRoot/dotfiles/docs/sideclaw-multimodal-task.md`** — they have the verified endpoint shapes,
   working model names, the residency-header trick, and the gotchas. Use them as the seed inventory.
2. Note the env vars: `IU_OPENAI_BASE_URL` (…/openai/v1), `IU_API_KEY` (bearer).
3. Recall gotchas: STT sniffs the **filename extension** (use `.mp3`); single-backend models flap `503`
   (retry with backoff); residency is exposed via `x-ms-region` / `x-middleware-forwarded-server` headers.

## What to Implement

1. **IU client** (`app/server/iu/client.ts`): thin `fetch` wrapper — base from `IU_OPENAI_BASE_URL`,
   `Authorization: Bearer ${IU_API_KEY}`, small retry/backoff on 503, returns body + captured headers.
   Never log the key.
2. **Catalog source**: `GET {base}/models` if available; else the seed inventory from the memos. Merge.
3. **Probe** (`app/server/iu/probe.ts`): for each candidate, do a minimal capability call —
   - LLM: tiny chat completion.
   - TTS: short `audio/speech` request.
   - STT: a tiny `audio/transcriptions` with a `.mp3` fixture.
   Record `accessible`, `latency_ms`, and `residency` (parsed from response headers) into
   `capability_probe`. Handle 503/410/4xx gracefully (model simply marked inaccessible).
4. **Entry points**: a server function + a CLI script wired as `bun run probe`.
5. Keep request volume minimal — this runs daily, not a load test.

## Validation

```bash
bun run typecheck && bun run lint
bun run test        # unit tests with mocked fetch (accessible/inaccessible/residency parsing/503 retry)
```

(A real live probe needs the IU key + network; tests must NOT depend on the live endpoint — mock it.)

## Commit

```
feat(probe): IU capability + residency probe into capability_probe
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 4
```
