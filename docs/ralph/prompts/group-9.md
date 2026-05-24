# Group 9: Audio playground

## What You're Doing

Build the TTS/STT playground. The **public** path serves only pre-computed static audio demos (no IU
token spend, no key exposure). An **admin gate** (a lightweight client-side `ADMIN_KEY`, not real auth)
unlocks live generation and curation: generate fresh demos via the IU endpoint, pick which appear publicly.

## Research & Exploration First

1. Re-read the residency table in `~/SourceRoot/dotfiles/docs/iu-multimodal-exploration.md`: for
   voice-sensitive content use the **EU** Azure-Sweden models (`tts`/`tts-hd`/`whisper`); flag US-vendor
   ones. Audio request shapes are in `sideclaw-multimodal-task.md`.
2. Read the Group 4 IU client and Group 3 `demo` table.
3. Confirm how TanStack Start serves static assets (the demo audio under `public/demos/`).

## What to Implement

1. **TTS playground (`/tts`)**: demo gallery grouped by model (static audio playback), **A/B compare**
   1..N models on the same text + emotion/preset, DE + EN preset texts. Read `demo` rows where `public`.
2. **STT playground (`/stt`)**: per-model sample transcription results side-by-side (accuracy/latency).
3. **Admin gate**: read `ADMIN_KEY` from localStorage/cookie; when present, show admin controls. This is
   a soft gate, not security — keep it simple. Server functions that spend IU tokens must check the key
   server-side too (reject without it) so the public path can't trigger generation.
4. **Live generation (admin)**: server fn → IU TTS (`audio/speech`) / STT (`audio/transcriptions`,
   `.mp3` filename!) → write audio to `public/demos/` + a `demo` row; toggle `public`.
5. Respect EU residency for any voice content; surface the model's residency in the UI.

## Validation

```bash
bun run typecheck && bun run lint
bun run test        # gate logic + demo query + generation server fn (IU mocked)
```

## Commit

```
feat(audio): TTS/STT playground with static demos + admin live generation
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 9
```
