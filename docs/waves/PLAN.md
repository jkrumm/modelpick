# German TTS comparison in /tts
**Goal:** `/tts` on :7727 plays a German TTS comparison (chat / briefing / podcast presets, 2–3 voices per
reachable model) with latency, first-audio, $/min, streaming and call syntax beside each sample, and
`docs/decisions/audio-stack.md` carries a per-lane recommendation pending Johannes' listening verdict.
**Gate:** `make check`, then `make deploy` + `make verify`. IU spend cap $3.

Full brief (established facts, voice preferences, budget, done criteria):
`~/tts-bakeoff-2026-10-25/BRIEF.md` on the mini — read it first.

## Wave 1 — Build, generate, compare            <!-- status: done -->
- [x] Research German voices per candidate model; pick 2 male (Mark/Charon-like) + 1 female per model
- [x] Demo audio served at request time (no rebuild needed for new samples); schema/page for metrics + blind mode
- [x] Generate chat / briefing / podcast samples within budget; transcript check; cost + latency + first-audio per sample
- [x] "How to call it" section per model family; Hermes streaming answer (read-only, file:line evidence)
- [x] Decision record section + per-lane recommendation; samples synced to `iumac:tts-bakeoff-2026-10-25/`
- [x] Gate green, committed, pushed, deployed, verified
**Left behind:** stopped: plan complete. 62 German samples on `/tts` (blind mode), request-time audio route, decision record
section with per-lane recommendation (Gemini 3.8 lite chat / flash briefing + podcast, pending listening), Hermes streaming
answer, call syntax. Spend ≈ $2.0 estimated of $3. Samples synced to `iumac:tts-bakeoff-2026-10-25/`. Open: Johannes' listening verdict.
