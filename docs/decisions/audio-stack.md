# Audio Stack — Cloud TTS + STT

**Decision (2026-05-25):** TTS and STT run on the **IU unified endpoint**, productionized by the
cloud **audio-proxy** service (`~/SourceRoot/audio-proxy`). TTS uses **`gemini-3.1-flash-tts-preview`**
(Charon voice); STT uses **`gpt-4o-transcribe`**, with EU **`whisper`** kept for the cases it
can't serve. This **supersedes** the 2026-04-29 local Apple-Silicon stack (Fish S2 Pro +
Parakeet), recorded at the bottom.

Operational wiring (the audio-proxy launchd service, ports, chunking/ffmpeg pipeline, secret
references) lives in the `audio-proxy` repo. This record is the *why*. For the Gemini TTS
*how* — route, voices, inline tags, request shape — see [../gemini-tts.md](../gemini-tts.md).

## Why cloud now

The local stack existed because, at the time, the only way to get an **expressive, EU-resident**
voice was to run it yourself: hosted `tts`/`tts-hd` had no emotion control, and capable hosted
expressive TTS wasn't EU-resident. Two things changed and removed local's reason to exist:

- **Gemini 3.1 Flash TTS closed the expressiveness gap — and it's EU-resident.** It supports
  director's-chair prompting + 200+ inline tags (the thing local Fish was kept for), and on the
  IU gateway it routes through the **"GDPR ONLY" Gemini gateway**, so personal voice content
  stays EU. The trade is a fixed prebuilt voice (Charon) instead of a cloned identity —
  acceptable for the actual use (Hermes longform), and worth it for zero local maintenance.
- **The local stack was pure maintenance cost.** mlx-audio Metal crashes, an 800-char Metal
  allocator cap, a launchd service to babysit. `localai` is retired; the cloud audio-proxy
  replaces it with no local inference to keep alive. IU per-token billing is effectively free at
  these volumes and off Max quota.

## TTS — Gemini 3.1 Flash (Charon)

Most expressive TTS on the IU endpoint, EU-resident, answered on the native `generateContent`
route (the OpenAI `/audio/speech` path 404s for Gemini). Default voice **Charon** (calm,
informative adult male — fits the Hermes persona). audio-proxy gives Hermes longform expressive
TTS over an OpenAI-compatible `/v1/audio/speech` by chunking, synthesizing per chunk, and
concatenating with ffmpeg. Full mechanics in [../gemini-tts.md](../gemini-tts.md).

## STT — gpt-4o-transcribe (whisper for the rest)

`gpt-4o-transcribe` is the most accurate STT on the endpoint and the primary pick. Two limits
shape how it's used:

- **Response formats.** It returns only `json`/`text` and rejects `verbose_json`/`srt`. The
  audio-proxy downgrades requests to `json` and synthesizes the rich envelope (segment
  timestamps) that clients expect, plus language steering. When genuine timestamp/subtitle output
  is needed (e.g. MacWhisper), use **`whisper`** instead.
- **Residency.** Per the verified IU capability matrix, `whisper` is EU-resident (Azure Sweden
  Central) while `gpt-4o-transcribe` routes to the **OpenAI vendor key (US)** — see
  [vision-and-image.md](./vision-and-image.md). The standing rule is that recorded personal voice
  stays EU, which `whisper` satisfies and `gpt-4o-transcribe` does not. *Open point: the committed
  primary STT being US-routed needs an explicit scope (gpt-4o-transcribe for non-sensitive /
  accuracy-critical audio, `whisper` for personal voice) — or a re-pick to keep the EU gate
  clean.*

**Diarization** (`gpt-4o-transcribe-diarize`) remains the one capability neither EU model offers,
for multi-speaker cases — accepting US routing for that specific use.

## Chunking & long-generation drift (still applies)

The old local stack chunked at **800 chars** because Fish's attention scratch blew past the Metal
allocator cap (~20 GB/buffer on an M2 Pro) around 1300 chars. That memory ceiling is gone, but the
*reason to chunk* survives in the cloud pipeline:

- **Long-generation drift.** A single Gemini TTS request can emit up to ~655 s (~10.9 min), but
  coherence degrades on very long single generations — the same failure mode that made the local
  ceiling comfortable rather than tight. Chunking keeps each unit short, bounded, and retryable,
  and lets audio-proxy run a prep-LLM pass + per-chunk synth before ffmpeg concat.
- **Silent truncation.** Under-budgeting a generation returns truncated audio without erroring —
  another argument for bounded chunks over one big request.

## Superseded: local Fish S2 Pro + Parakeet (2026-04-29)

The prior decision ran both locally on Apple Silicon — TTS **Fish S2 Pro** (8-bit MLX, ~6.7 GB),
STT **NVIDIA Parakeet TDT v3** (mlx, ~1.2 GB) — chosen over hosted alternatives and a wide field
of local engines (Voxtral, Qwen3-TTS, F5-TTS-German, Piper, Kokoro, Orpheus, VibeVoice; Whisper on
mlx-audio was unusable due to a `WhisperProcessor` / Metal-threading bug). Fish won a blind
listening test on cloned, emotion-tagged German/English voices. Lessons worth keeping:

- **Reference-clip quality dominates clone quality.** Fish clones timbre *and* cadence; synthetic
  references clone-of-clone catastrophically. Real human voice in → real human voice out. A "smile
  EQ" baked into the *reference clip* (not just the output) and a +5% reference-side `atempo`
  shaped delivery more than any output post-processing. *(Clone-specific — does not apply to
  Gemini's prebuilt voices.)*
- **German was Tier-2** (less training data, not an accent); cloning can't fix the underlying
  phonological flatness — only a good real reference + EQ compensates.

The full eval table, EQ chains, and per-engine rejection notes are in this file's git history.
