# German TTS comparison in /tts
**Goal:** `/tts` on :7727 plays a German TTS comparison (chat / briefing / podcast presets, 2–3 voices per
reachable model) with latency, first-audio, $/min, streaming and call syntax beside each sample, and
`docs/decisions/audio-stack.md` carries a per-lane recommendation pending Johannes' listening verdict.
**Gate:** `make check`, then `make deploy` + `make verify`. IU spend cap $3.

Full brief (established facts, voice preferences, budget, done criteria):
`~/tts-bakeoff-2026-10-25/BRIEF.md` on the mini — read it first.

## Wave 1 — Build, generate, compare            <!-- status: active -->
- [ ] Research German voices per candidate model; pick 2 male (Mark/Charon-like) + 1 female per model
- [ ] Demo audio served at request time (no rebuild needed for new samples); schema/page for metrics + blind mode
- [ ] Generate chat / briefing / podcast samples within budget; transcript check; cost + latency + first-audio per sample
- [ ] "How to call it" section per model family; Hermes streaming answer (read-only, file:line evidence)
- [ ] Decision record section + per-lane recommendation; samples synced to `iumac:tts-bakeoff-2026-10-25/`
- [ ] Gate green, committed, pushed, deployed, verified
**Left behind:**
