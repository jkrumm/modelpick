# Audio Stack — Cloud TTS + STT

**Update (2026-08-26): TTS moves to ElevenLabs via the IU Replicate route** — `elevenlabs/flash-v2.5`
for chat replies, `elevenlabs/v3` for briefings; Gemini stays served but is no longer the default.
STT unchanged. Details in [TTS re-pick](#tts-re-pick-2026-08-26-elevenlabs-via-replicate) below.

**Decision (2026-05-25):** TTS and STT run on the **IU unified endpoint**, productionized by the
**audio-gateway** service (`~/SourceRoot/audio-gateway`, VPS Docker container at
`audio-gateway.jkrumm.com`). TTS uses **`gemini-3.1-flash-tts-preview`** (Charon voice); STT
uses **`gpt-4o-transcribe`**, with EU **`whisper`** kept for the cases it can't serve. This
**supersedes** the 2026-04-29 local Apple-Silicon stack (Fish S2 Pro + Parakeet), recorded at
the bottom.

`audio-proxy` (macOS LaunchAgent on `:7716`, `~/SourceRoot/audio-proxy`) is **RETIRED**
(2026-06-17) — LaunchAgent removed, GitHub repo archived. Its function is fully replaced by
audio-gateway.

Operational wiring (the Docker container, ports, chunking/ffmpeg pipeline, secret references)
lives in the `audio-gateway` repo. This record is the *why*. For the Gemini TTS *how* — route,
voices, inline tags, request shape — see [../gemini-tts.md](../gemini-tts.md).

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
  allocator cap, a launchd service to babysit. `localai` is retired; the VPS audio-gateway
  replaces it with no local inference to keep alive. IU per-token billing is effectively free at
  these volumes and off Max quota.

## TTS — Gemini 3.1 Flash (Charon)

Most expressive TTS on the IU endpoint, EU-resident, answered on the native `generateContent`
route (the OpenAI `/audio/speech` path 404s for Gemini). Default voice **Charon** (calm,
informative adult male — fits the Hermes persona). audio-gateway gives Hermes longform expressive
TTS over an OpenAI-compatible `/v1/audio/speech` by chunking, synthesizing per chunk, and
concatenating with ffmpeg. Full mechanics in [../gemini-tts.md](../gemini-tts.md).

## STT — gpt-4o-transcribe (whisper for the rest)

`gpt-4o-transcribe` is the most accurate STT on the endpoint and the primary pick. Two limits
shape how it's used:

- **Response formats.** It returns only `json`/`text` and rejects `verbose_json`/`srt`. The
  audio-gateway downgrades requests to `json` and synthesizes the rich envelope (segment
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
  and lets audio-gateway run a prep-LLM pass + per-chunk synth before ffmpeg concat.
- **Silent truncation.** Under-budgeting a generation returns truncated audio without erroring —
  another argument for bounded chunks over one big request.

## TTS re-pick (2026-08-26): ElevenLabs via Replicate

The trigger was latency, and the first finding was that the *model* was never the bottleneck.
Measured end-to-end against `audio-gateway.jkrumm.com` for one German sentence:

| Stage | Before | After prep swap | After vendor swap |
|-|-|-|-|
| prep LLM | 8.5–21 s (`DeepSeek-V4-Pro`) | 2.0 s (`gpt-5.6-luna`) | 0 (off for chat) |
| synth | 6–8 s (Gemini, ~10 s audio) | 6–8 s | 1.2 s (`flash-v2.5`, 6.6 s audio) |
| end-to-end | 17–30 s | 8.7–10.5 s | **1.2–1.5 s** |

Two facts about the Hermes side decided the shape (see `hermes-agent` CLAUDE.md for the wiring):

- Hermes cannot reach any IU-routed TTS natively. Its `elevenlabs`/`minimax`/`gemini`/`xai`
  providers call the vendors' own APIs with vendor keys; there is no Replicate provider. The only
  door to the IU key is the `openai` provider pointed at audio-gateway — so the gateway is the
  adapter, not an optional layer, and a vendor swap is a gateway change with zero client change.
- Desktop voice mode and CLI voice mode stream **sentence by sentence** with a 3-deep prefetch
  (`tools/tts_tool.py` `stream_tts_to_speaker`). The number the ear hears is per-sentence request
  latency, which made the per-request prep LLM (2 s) and Gemini's ~0.7× real-time synth the whole
  problem. Slack replies are whole-file, so they just get the same gain once.

Two models, one vendor, routed by model id inside the gateway:

| Lane | Model | Prep LLM | Why |
|-|-|-|-|
| chat (desktop, CLI, Slack replies) | `elevenlabs/flash-v2.5` | off | one prediction per sentence, ~1.2 s; emotion only via `stability`/`style` |
| briefings / long-form | `elevenlabs/v3` | on | AA #5 (Gemini #7); prep gives spoken-form numbers, ~110-word chunks, sparse v3 audio tags, a title (`X-Audio-Title`), `previous_text`/`next_text` continuity; ~10 s per 40 s of audio |

Replicate never streams audio — every candidate returns a finished URL — so ~1 s is the floor per
request; Hermes' prefetch hides everything after the first sentence. Of AA's top-12 TTS, four are
reachable on the IU key at all (ElevenLabs v3, Gemini 3.1 Flash TTS, Inworld 1.5-max/2); Cartesia,
Speechify, VUI, StepFun are not. MiniMax/Inworld/Grok measured 2.0–2.7 s on the same sentence.

**Not reachable, and the real upgrade path:** `eleven_v3_conversational` (v3 expressiveness at
~280 ms model latency, WebSocket streaming, $0.05/1k chars) exists only in ElevenLabs' direct API.
With an ElevenLabs account Hermes' native `elevenlabs` provider would stream it directly
(first audio ~300 ms instead of ~1.2 s) and the gateway would keep only STT + briefings. Open
until the Replicate lane has been lived with.

**Residency:** the Replicate route is US-routed. Payload is Hermes' reply text (calendar, tasks),
not recorded voice — the EU rule in this file is about recorded personal voice, which stays on the
STT path as before. Accepted knowingly; Gemini (EU) remains one `model:` field away.

**Voice:** ElevenLabs on Replicate exposes a fixed name list (no custom voice ids). **`Mark`**, chosen
by ear (2026-08-26) over Roger, Drew, Paul, Bradford, James and Clyde on both models — German samples,
`language_code: de`. ElevenLabs bills Mark as its conversational-AI voice, which fits the chat lane.

**STT stays `gpt-4o-transcribe`.** ElevenLabs Scribe v2 leads German WER (2.27 % vs Whisper large-v3
4.26 % on the Open ASR German track; gpt-4o-transcribe is unranked there) and is on the Replicate
route, but it is URL-in/JSON-out and Hermes' native ElevenLabs STT needs a vendor key — a gateway
adapter later, only if transcripts show real errors. One Hermes bug fixed on the way: upstream
defaults `stt.language: en`, which was forced onto every German voice message; now auto-detect.

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
