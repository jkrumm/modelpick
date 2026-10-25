# Audio Stack — Cloud TTS + STT

> **Current verdict (2026-09-12):** TTS runs ElevenLabs via the IU Replicate route
> (`elevenlabs/flash-v2.5` chat, `elevenlabs/v3` briefings, voice `Mark`), with Gemini 3.1
> Flash TTS kept served as the EU-resident fallback. STT is `gpt-transcribe` since 2026-10-15
> (US-routed, like the `gpt-4o-transcribe` it replaces) with `whisper` for EU/diarization gaps —
> the primary STT's US routing is still an open residency question. See
> [STT re-pick (2026-10-15)](#stt-re-pick-2026-10-15-gpt-transcribe).
> **Status of this record:** partly superseded — see §TTS re-pick (2026-08-26): ElevenLabs via
> Replicate, which moved the top-level 2026-05-25 TTS decision (Gemini 3.1 Flash default).
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

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

**Validated through Hermes itself (2026-08-26, `hermes serve` on the mini, session-cookie login):**

| Hermes path | Endpoint / class | Result |
|-|-|-|
| desktop client-direct config | `GET /api/audio/voice-config` | `tts: elevenlabs/flash-v2.5 / Mark`, `stt: gpt-4o-transcribe, language: null` (auto) |
| desktop non-streaming reply | `POST /api/audio/speak` | 1.44 s, MP3 data URL |
| desktop streaming reply | `WS /api/audio/speak-stream` (ticket auth) | first PCM frame 1.6 s, 46 frames, 7.8 s audio in 3.9 s — sentence 2 synthesized while sentence 1 streamed |
| voice message in | `POST /api/audio/transcribe` → gateway → `gpt-4o-transcribe` | 1.9 s, verbatim German transcript |
| Slack whole-file reply | `tts_tool._generate_openai_tts` | Flash 0.9 s; v3 briefing returns the title via `X-Audio-Title` |
| CLI voice mode streamer | `tts_streaming.OpenAIStreamer` (pcm) | 1.0–1.9 s per sentence, correct 24 kHz s16le byte count |

**Optimized after the switch:** Replicate-lane chunks 110 → 60 words (`TTS_REPLICATE_CHUNK_*`): a
110-word briefing synthesizes as three parallel chunks (max 4.1 s) instead of one 6.3 s chunk —
prod end-to-end 10.9 → 9.6–10.5 s. The prep LLM is now the largest stage (~5 s for ~500 output
tokens). Bake-off on the real v3 prep prompt: `gpt-5.6-luna` 6.0 s (JSON ok), `gemini-3.7-flash`
4.4 s (JSON ok, US-routed), `gemini-3.5-flash-eu` 10.6 s (reasoning blew the token cap, no JSON),
`DeepSeek-V4-Flash` 23 s. Luna stays — ~1.5 s on a cron path isn't worth leaving the verified
EU model. Prod usage since the switch: flash-v2.5 avg 1.15 s / max 1.32 s over 6 calls, 0 errors.

**Language per sentence (2026-08-26, raised by Hermes itself):** the streaming client sends one
hint-less sentence per request, and the original DE/EN heuristic sent 11 of 13 typical short
German replies ("Klar.", "Mach ich.", "Termin eingetragen.") to ElevenLabs as `language_code=en`
— audibly English-accented. Fixed in the gateway, not in Hermes: three-way detection (DE markers →
de, EN markers → en, else `TTS_DEFAULT_LANGUAGE=de`), and every Replicate usage row now records the
code sent. Audited on prod: de/de/de for the German set, en/en for "Sure thing." / "Meeting moved
to three pm.". No Hermes patch — its sentence prefetch (3-deep) already overlaps synthesis with
playback, which the `speak-stream` measurement above confirms.

**Desktop read-aloud (2026-08-26):** the "one line after another" feel was the desktop's client-direct
session — it synthesizes and plays strictly sequentially (`voice-playback.ts` pump), so every
sentence boundary was a full gateway round trip of silence. `voice.client_direct: false` moves both
TTS and STT to the relay path through `hermes serve`, which schedules PCM back-to-back and prefetches
server-side. On top, a serve patch (`hermes-agent/patches/serve-speak-summary.patch`,
`voice.speak_summary_min_chars: 250`) speaks a one-sentence gateway summary (`summarize: true`,
Luna → Flash) for finished replies over 250 chars instead of reading them out: a 428-char reply
became 5 s of audio, first PCM at 4.9 s; short replies are still read in full; live voice
conversation is untouched because its text arrives incrementally.

**Observability (2026-08-26):** two layers, deliberately. SQLite/Argo usage rows are the cost
accounting and now carry a `request_id`, one `*-request` row per call (mode, lane, chunks, language,
end-to-end latency) and the input/spoken/transcribed text (600 chars, `USAGE_KEEP_TEXT`) —
`bun run usage:tail --prod` prints the timeline with p50/p95 rollups. ClickStack/HyperDX gets one
trace per request (trace id = request id) with stage spans and every log line, via a dependency-free
OTLP/HTTP JSON exporter — the repo's no-npm-deps rule held. First traces showed the Replicate lane's
shape exactly: `predict_time` 0.3 s inside a 1.0 s chunk span — ~0.5 s is Replicate scheduling and
~0.2 s delivery fetch, i.e. the ~1 s floor is the vendor route, not the gateway. Dashboard tiles:
`audio-gateway/docs/hyperdx-dashboard.md`. Summary prompt tightened to ~18 words after the first
timeline showed 181-char (9.5 s) summaries; now 77 chars / 4 s.

**Slack voice replies (2026-08-27):** two Hermes facts decided the shape. `voice.auto_tts` is one
global flag shared by the desktop's read-aloud toggle and the Slack runner, and upstream's runner
reads it as "speak every reply in chats without a `/voice` mode" — alerts and deploy markers came back
as MP3s. Local patch: the global default answers voice input only (`/voice all` per chat keeps the old
behaviour). Slack cannot ask for a summary, so the gateway decides it: whole-file requests ≥ 120 chars
on a prep-off model go through the spoken-rendering LLM (`gemini-3.5-flash-lite`, ~1 s), which picks
its own length — a confirmation is one clause, a requested weather report stays whole. The
`X-Audio-Title` rename now also covers the runner's temp files, so the Slack bubble is titled.

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

## STT re-pick (2026-10-15): gpt-transcribe

**Why now:** on 2026-08-26 OpenAI announced that `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`,
`gpt-4o-transcribe-diarize` and `whisper-1` shut down on **2027-02-26**; the named successor for
file transcription is `gpt-transcribe` (released 2026-07-28, $0.0045/min vs $0.006). It is live on
the IU OpenAI leg (routed through the OpenAI vendor key, so the same US routing as before).

**Measured on the IU endpoint (German voice memo, 16 kHz mono mp3):**

| Clip | Model | chars/s | unique sentences | longest repeat |
|-|-|-|-|-|
| 240 s | gpt-4o-transcribe | 19.3 | 100% | 1 |
| 240 s | gpt-transcribe | 19.3 | 100% | 1 |
| 480 s | gpt-transcribe | 19.8 | 98% | 1 |
| 900 s | gpt-transcribe | 19.4 | 100% | 1 |
| 1500 s | gpt-transcribe | 19.1 | 100% | 1 |

Word-level diff between the two models on the 240 s clip: 3.6%, mostly hyphenation
(`Private-Equity-Partner`) and punctuation. No repetition collapse (gpt-4o-transcribe loops past
~300 s) and no truncation or 1400 s cap up to 1500 s; 1500 s took 40 s wall clock. The response is
`{text, languages:[{code}], usage:{type:"duration",seconds}}`; `verbose_json`/`srt` are rejected
(503, "use json or text"), so the gateway keeps synthesizing the envelope and `whisper` stays the
native-timestamp model until its own shutdown. audio-gateway keeps its 240 s chunk ceiling for
concurrency within its 255 s socket budget, not for quality.

**Not settled:** no published German WER for `gpt-transcribe`; diarization has no successor on
this endpoint yet.

## TTS field re-check (2026-10-25): Gemini 3.8 overtakes ElevenLabs v3

**Trigger:** ElevenLabs v4 / v4 Turbo (2026-09-28) top the AA Speech Arena but are still absent
from Replicate (the IU route 404s every v4 slug); only OpenRouter hosts them, outside the IU key.
Replicate's past lag for ElevenLabs models was ~2–4 months (v3: API 2025-08-20 → Replicate
2025-10-23; Scribe v2: 2026-01-09 → 2026-05-05), so v4 is expected around Dec 2026–Jan 2027.

**AA Provider Voice Arena (page dated 2026-10-24), IU-reachable models only:**

| Model | Rank | Elo |
|-|-|-|
| `gemini-3.8-flash-tts` | 5 | 1280 |
| `inworld/realtime-tts-2` | 6 | — (German board #2 at launch, 1261) |
| `gemini-3.8-flash-lite-tts` | 8 | 1252 |
| `gemini-3.1-flash-tts-preview` | 16 | 1213 |
| `elevenlabs/v3` (current briefing/podcast model) | 21 | — |
| `minimax/speech-2.8-hd` / `-turbo` | 24 / 27 | 1176 / 1156 |
| `qwen/qwen3-tts` | 87 | 930 |

`gpt-4o-mini-tts` is unranked and deprecated by OpenAI; `elevenlabs/flash-v2.5` (chat lane) is
not in AA's top 30. No German WER/MOS exists for any of them.

**Measured on the IU endpoint (German, same text per lane, mini → IU):**

| Model | Short reply (3 runs, finished file) | Streaming first audio | Notes |
|-|-|-|-|
| `elevenlabs/flash-v2.5` | 1.5–2.5 s | — (Replicate never streams) | current chat lane |
| `gemini-3.8-flash-lite-tts` | 2.2–2.7 s | **0.6–0.8 s** (`streamGenerateContent?alt=sse`) | |
| `gemini-3.8-flash-tts` | 3.5–4.2 s | 0.8–1.1 s | |
| `inworld/realtime-tts-2`, `xai/grok-text-to-speech`, `minimax/speech-2.8-turbo` | 2.3–3.1 s | — | |

All 17 samples round-tripped through `gpt-transcribe` verbatim (numbers, times, umlauts).
Gemini 3.8 traps: a `Style: text` prefix (the 3.1 convention) is **read aloud**;
`systemInstruction` is rejected ("Developer instruction is not enabled for this model");
`speechConfig.speechMetadata` is an unknown field on the IU route; inline `[friendly]`-style
tags work. Gemini 3.8 also does 2-speaker synthesis in one request (`multiSpeakerVoiceConfig`).

**Realtime speech-to-speech is not reachable on the IU key:** every `gpt-realtime*` / `gpt-live*`
id is `not_routed`, the Gemini Live ids 400 on `generateContent`, and the Live WebSocket
(`BidiGenerateContent`) does not upgrade on any `/gemini/...` path. Voice agents stay a cascade
(STT → LLM → streaming TTS), which is what Hermes already runs.

**Open:** the blind listening verdict (samples kept outside the repo), then whether chat moves to
streaming `gemini-3.8-flash-lite-tts` and briefings/podcasts to `gemini-3.8-flash-tts`.

## German TTS comparison (2026-10-25): per-lane recommendation, pending the listening verdict

62 samples (chat / briefing / podcast, same German text per preset, 2–3 voices per model) play on
`/tts` at :7727 with a blind mode; the numbers below come from `data/tts-compare/manifest.json`
(`scripts/tts-compare.ts` regenerates it, audio is served at request time from `data/tts-compare/audio/`
by `/api/tts-audio/<file>`, so new samples need no rebuild). Quality is **not decided here** — it
waits on Johannes' listening; the recommendation is cost/latency/streaming plus the AA ranks.

| Model | Voices | AA rank | Chat (median of 3, finished) | Briefing (finished) | First audio (streamed) | $/min (list) | Transcript verbatim |
|-|-|-|-|-|-|-|-|
| `gemini-3.8-flash-tts` | Charon, Rasalgethi, Sulafat | #5 (1280) | 2.7 s | 7.3 s | **0.6 s** | $0.013 | 6/8 |
| `gemini-3.8-flash-lite-tts` | Charon, Rasalgethi, Sulafat | #8 (1252) | 1.7 s | 4.6 s | **0.5 s** | $0.009 | 4/7 |
| `inworld/realtime-tts-2` | Dennis, Alex, Ashley | #6 (1261) | 2.8 s | 6.1 s | — | $0.024 | 3/7 |
| `elevenlabs/v3` | Mark, James, Sarah | #21 | 4.2 s | 10.7 s | — | $0.087 | 4/7 |
| `elevenlabs/flash-v2.5` | Mark, James, Sarah | not top 30 | 1.4 s | — | — | $0.046 | 2/3 |
| `minimax/speech-2.8-hd` / `-turbo` | German_FriendlyMan, _PlayfulMan, _SweetLady | #24 / #27 | 2.8 / 2.9 s | 5.4 s | — | $0.093 / $0.055 | 5/9 |
| `xai/grok-text-to-speech` | rex, leo, ara | n/a | 2.4 s | 3.8 s | — | $0.014 | 4/7 |
| `qwen/qwen3-tts` | Uncle_fu, Ryan, Serena | #87 | 8.5 s | 25.6 s | — | $0.015 | 5/7 |
| `gpt-4o-mini-tts-2025-12-15` | cedar, onyx, coral | unranked | 2.0 s | 4.8 s | none (see below) | $0.015 | 4/7 |

Read the table with these caveats: Gemini latency is the full SSE stream; podcast latency for
non-multi-speaker models is the wall clock of the six turns synthesized **in parallel** (production
would be sequential or chunked); `$/min` is list price over the measured audio length (Gemini: 25
audio tokens/s; Replicate models: per input character; sources in each manifest row). The
"verbatim" column is a `gpt-4o-transcribe` round trip with numbers spelled out on both sides;
nearly every miss is orthography (`mach`→`mache`, "Uhr" dropped, `stecken bleiben`→`steckenbleiben`).
Real misreads: MiniMax PlayfulMan "mach"→"maik", Inworld Dennis briefing "Ziel"→"CEO", OpenAI
onyx briefing "Achtzehn Monate"→"nach zehn Monat". Per-sample diffs are in the manifest.

### Recommendation per lane (pending listening)

| Lane | Pick | Why | Fallback |
|-|-|-|-|
| chat | `gemini-3.8-flash-lite-tts` via `streamGenerateContent`, Charon or Rasalgethi | first audio ~0.5 s vs 1.4 s for a finished flash-v2.5 file, $0.009/min vs $0.046, AA #8 vs unranked | keep `elevenlabs/flash-v2.5` Mark if the Gemini voice loses the listen |
| briefing | `gemini-3.8-flash-tts`, Charon or Rasalgethi, streamed | AA #5, 0.6 s first audio, 1/7 of v3's cost; 3 of 3 voices verbatim except one `habe`→`hab` | `inworld/realtime-tts-2` (AA #6, finished-file only) |
| podcast | `gemini-3.8-flash-tts` multi-speaker in one request (Charon/Rasalgethi + Sulafat) | one call, both voices, ~9 s for 31 s of audio, verbatim | `elevenlabs/v3` Mark + Sarah turn by turn (current) |

Not worth a slot: `qwen/qwen3-tts` (8–30 s, no German-native speaker), `gpt-4o-mini-tts` (deprecated,
shuts down 2027-01-06, IU buffers it), MiniMax HD (3–7x the Gemini price, AA #24).

### Streaming and Hermes (read-only, `~/.hermes/hermes-agent`)

Only Gemini streams through IU. `gpt-4o-mini-tts` on `/audio/speech` returns first byte ≈ total
time (2.0 s vs 2.0 s chat, 4.4 s vs 4.5 s briefing): IU buffers it. Replicate returns a finished URL.

Does streaming Gemini PCM through audio-gateway make Hermes speak earlier? **Yes on one path, no on the other:**
- `tools/tts_streaming.py:306-316` (CLI voice mode and desktop speak-stream): `with_streaming_response.create(... response_format="pcm")`, then `yield from _capped(response.iter_bytes(), ...)`; `hermes_cli/web_routers/audio.py:821` iterates it and `:891` does `ws.send_bytes(chunk)` per chunk. Progressive, so a gateway that forwards Gemini PCM as it arrives cuts time-to-first-audio per sentence from the full synthesis (1.0–1.9 s today) to the first Gemini chunk (~0.5 s). The sample-rate header must be sent before the body (`tts_streaming.py:310`, read on the first `next()`); PCM must be 24 kHz s16le.
- `tools/tts_tool_openai.py:155-157` (Slack/file replies via `text_to_speech_tool`): `with_raw_response.create(...)` then `fh.write(raw.content)`. Waits for the whole body, no benefit. It also needs the `X-Audio-Title` header, so it cannot stream anyway.

### How to call it

Gemini 3.8 (`{IU_GEMINI_BASE_URL}/models/<id>:streamGenerateContent?alt=sse`, headers `Authorization: Bearer` and `x-goog-api-key`; each SSE event carries base64 `audio/l16; rate=24000` PCM):

```json
{"contents":[{"parts":[{"text":"Klar, mach ich."}]}],
 "generationConfig":{"responseModalities":["AUDIO"],
  "speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Charon"}}}}}
```
Multi-speaker (max 2, prebuilt voices only): replace `voiceConfig` with
`multiSpeakerVoiceConfig.speakerVoiceConfigs:[{speaker,voiceConfig}…]` **and** give every text part
`speechMetadata:{speaker:"Mark"}` (without it: 400 "must specify speech_metadata.speaker for each
text part"). Traps: a `Style:` prefix is read aloud; `systemInstruction` → 400; `speechConfig.speechMetadata`
is unknown (the per-part one is fine); non-streaming `generateContent` returns a **WAV container**
(`audio/wav`) while the stream is raw PCM — do not wrap the former again; inline `[friendly]` tags work;
language is auto-detected, no German-specific voice guidance exists. Charon/Rasalgethi are "Informative"
males, Sulafat the "Warm" female.

Replicate (`{IU_REPLICATE_BASE_URL}/models/<owner>/<name>/predictions`, header `Prefer: wait`, then poll
`/predictions/<id>` and fetch `output`; no streaming). Inputs differ per model and voice enums are strict (a bad voice is a 422):

| Model | Input |
|-|-|
| `elevenlabs/v3`, `flash-v2.5` | `prompt`, `voice` ∈ Rachel, Drew, Clyde, Paul, Aria, Domi, Dave, Roger, Fin, Sarah, James, Jane, Juniper, Arabella, Hope, Bradford, Reginald, Gaming, Austin, Kuon, Blondie, Priyanka, Alexandra, Monika, Mark, Grimblewood; `language_code:"de"`, `stability`, `similarity_boost`, `style` |
| `minimax/speech-2.8-{hd,turbo}` | `text`, `voice_id` (German_FriendlyMan / _SweetLady / _PlayfulMan are the only documented German ids), `language_boost:"German"`, `emotion:"auto"` |
| `inworld/realtime-tts-2` | `text`, `voice_id` (free string; Dennis, Alex, Ashley work), `language:"de"`; steering via `[say calmly]` brackets |
| `xai/grok-text-to-speech` | `text`, `voice` (rex, leo, ara, …; xAI publishes no gender), `language:"de"` |
| `qwen/qwen3-tts` | `text`, `speaker` ∈ Aiden, Dylan, Eric, Ono_anna, Ryan, Serena, Sohee, Uncle_fu, Vivian (case-sensitive), `language:"German"`, `style_instruction` |

OpenAI route: `POST {IU_OPENAI_BASE_URL}/audio/speech` `{model:"gpt-4o-mini-tts-2025-12-15", input, voice, instructions, response_format}`
(voices cedar/marin are OpenAI's pick; German is "optimized for English" only).

**Spend:** about $2.0 of the $3 cap, estimated from list prices (IU reports no cost on these routes): one
aborted full run, its rerun, and targeted reruns after voice-enum 422s (ElevenLabs `Brian`, Qwen `Uncle_Fu`).
**Open:** the listening verdict (samples synced to `iumac:tts-bakeoff-2026-10-25/`), Sarah's ElevenLabs
production voice id is not verifiable here, and a gateway that streams Gemini PCM does not exist yet.

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
