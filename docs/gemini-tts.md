# Gemini 3.8 TTS — expert reference

*The doc audio-gateway and Hermes follow for every Gemini TTS lane. Sources: Google docs and
changelog as of 2026-10-24 (research report), practitioner reports (forums, issue trackers, blog
tests), and an IU probe matrix run 2026-10-25 — every claim below is tagged **docs**, **IU** (proven
through the IU gateway) or **field** (practitioner report, unconfirmed here). Where docs and IU
disagree, IU wins for our code. The stack decision lives in
[`decisions/audio-stack.md`](decisions/audio-stack.md); this file is mechanics.*

## Models

| | `gemini-3.8-flash-lite-tts` | `gemini-3.8-flash-tts` |
|-|-|-|
| Use | chat replies (prep off) | briefings, podcasts |
| Artificial Analysis | #8 | #5 |
| Audio-out price | $6 / 1M tokens | $9 / 1M tokens |
| Per minute (25 tok/s) | ≈ $0.009 | ≈ $0.0135 |
| Price from 2027-01-01 | $12 → ≈ $0.018/min | $18 → ≈ $0.027/min |
| Languages | 101 | 130+ |
| First audio, streamed (decision record) | 0.5–0.8 s | 0.6–1.1 s |

Both: GA 2026-09-22, 8,192 input / 16,384 output tokens (docs), 25 audio tokens per second, text input
$0.50 / 1M. **IU:** both are reachable; the legacy `gemini-3.1-flash-tts-preview` and
`gemini-2.5-flash-preview-tts` shut down 2026-11-17 (docs). Vertex lists the 3.8 models as Preview/global
only — irrelevant here, we use the Gemini API door on IU (EU-resident "GDPR ONLY" route).

## Request shapes

Native endpoint only. The OpenAI `/audio/speech` route 404s for Gemini.

```
POST {IU_GEMINI_BASE_URL}/models/<model>:generateContent            # whole file
POST {IU_GEMINI_BASE_URL}/models/<model>:streamGenerateContent?alt=sse   # progressive
Authorization: Bearer $IU_API_KEY     (IU also accepts x-goog-api-key)
```

### Single speaker

```json
{
  "contents": [{ "parts": [{ "text": "Das Deployment läuft sauber. <short pause> Drei Termine heute." ,
                             "speechMetadata": { "style": "calm, warm, conversational" } }] }],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Charon" } } }
  }
}
```

### Multi-speaker (podcast)

One part per turn; speaker name must match a configured speaker exactly. **IU:** `Name: text` prefixes
in one text block are rejected (`Multi-speaker generation requests must specify speech_metadata.speaker
for each text part`).

```json
{
  "contents": [{ "parts": [
    { "text": "Willkommen zurück.", "speechMetadata": { "speaker": "Mark", "style": "warm, conversational" } },
    { "text": "Und die Antwort ist nicht die Technik, oder?", "speechMetadata": { "speaker": "Sarah", "style": "curious" } }
  ] }],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": { "multiSpeakerVoiceConfig": { "speakerVoiceConfigs": [
      { "speaker": "Mark",  "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Charon" } } },
      { "speaker": "Sarah", "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Sulafat" } } }
    ] } }
  }
}
```

Hard limits (docs): **2 speakers**, prebuilt voices only in one request (designed/replicated voices need
one request per speaker), `voiceConfig` and `multiSpeakerVoiceConfig` are mutually exclusive.

### Field map: docs vs IU

| Field / feature | Docs | IU probe (2026-10-25) |
|-|-|-|
| Style, per turn | `speech_metadata.style` (Interactions: `annotations[]`) | **works on the part**: `parts[].speechMetadata.style` (camelCase) and `parts[].speech_metadata.style` both accepted. In `speechConfig` → 400 `Unknown name` |
| `annotations[]` on a part | Interactions API shape | 400 `Unknown name "annotations"` |
| `systemInstruction` | rejected on 3.8 | 400 `Developer instruction is not enabled for this model` |
| `temperature` / `seed` | docs say rejected on 3.8 | **accepted** (200). Do not rely on them; no stability gain proven |
| Single voice shorthand `voiceConfig.voice` | used in the 3.8 guide | accepted (200) — use `prebuiltVoiceConfig.voiceName`, the canonical form |
| `speechConfig.languageCode` (`de-DE`) | optional | accepted; not needed, language is auto-detected |
| Unknown voice name | — | 400 `No matching speaker voice found` |
| Output, unary | `audio/wav`, 44-byte RIFF header | confirmed: 24 kHz mono s16le WAV. Strip 44 bytes for PCM |
| Output, stream | `audio/l16`, headerless PCM chunks | confirmed (`audio/l16; rate=24000; channels=1`), ~60 chunks for a 5 s clip; both `?alt=sse` and plain array framing work |
| `generationConfig.responseFormat.audio.mimeType` | `AUDIO_WAV` / `AUDIO_L16` / `AUDIO_MULAW` / `AUDIO_ALAW` + `sampleRate` | **works**: `AUDIO_L16` on unary → raw PCM (`audio/l16`), `AUDIO_MULAW` + 8000 → `audio/mulaw; rate=8000`. `sampleRate: 16000` with L16 still returned 24000 — treat 24 kHz as fixed for PCM |
| MP3 / OGG / FLAC | not offered | not offered — `audioConfig` → 400. Encode with ffmpeg |
| `speechConfig.sampleRateHertz`, `speechConfig.audioConfig` | — | 400 `Unknown name` |
| Interactions API (`/interactions`) | documented | 405 — not routed |
| Extended Voice Library `GET /voices`, voice design `POST /voices` | GA 2026-09-22 | 500 / 405 — **not available on IU**; the 30 prebuilt voices are the whole catalogue for us |
| Usage | `usageMetadata.candidatesTokenCount` | unary returns real audio tokens (≈ 25 × seconds); streamed usage reports `1` — compute cost from duration × 25 for streams |

## Style control

Three levers, three jobs. Everything else is a trap.

1. **`speechMetadata.style`** — sustained delivery for one turn: a **short** free-text string
   (`"calm, warm, conversational"`, `"speaking slowly"`, `"serious, a little incredulous"`). Not spoken,
   not read aloud (IU: transcript round trip clean). It changes tempo and energy measurably — same
   sentence, same voice: no style 5.0 s, `speaking rapidly` 3.8 s, `calm, warm, unhurried` 6.2 s,
   `very slow, whispering` 9.3 s. Docs: leave it empty by default, add it only where a turn needs
   adjustment, and reuse the exact same string across turns for a consistent baseline. English style
   strings work for German text (German ones also work; no leakage either way).
2. **Inline `<tags>`** — point-in-time events only (below).
3. **Punctuation and CAPS** — commas, dashes and ellipses shape hesitation; `This is a VERY important
   point` stresses the word (docs). IU: an ellipsis pause (`Erster Satz... Zweiter Satz.`) shortened the
   audio and merged words; prefer `<short pause>`.

**Traps (all proven on IU or documented):**

- **Spoken prefix.** `"Calm, warm: <text>"` — the 3.1 convention — is spoken or garbled by 3.8 (heard
  "Kein Wahn, das Deployment läuft…"). 3.8 treats `text` as a verbatim transcript; direction in the text
  gets read aloud.
- **No persona blocks.** Audio-profile / director's-notes paragraphs are the documented top cause of voice
  drift on 3.8. Do not add "keep the voice steady" instructions either — docs say they increase drift.
- No age, gender, names or permanent accent changes in `style`.
- Do not put words from the transcript inside `style`.

## Tag vocabulary

**3.8 uses angle brackets** (migration guide: `[sigh]` → `<sigh>`). The list is closed (~40 human
vocalisations + 2 pauses); off-list tags are ignored, and some (`<sniff>`, field) make the *following*
tags get read aloud.

| Kind | Tags |
|-|-|
| Pauses | `<short pause>` (~250 ms), `<long pause>` (~1 s) — no `<medium pause>` on 3.8 |
| Vocalisations | `<laugh>` `<laughter>` `<chuckle>` `<giggle>` `<cackle>` `<snicker>` `<sigh>` `<breath>` `<heavy breath>` `<exhales>` `<gasp>` `<groan>` `<moan>` `<cough>` `<throat-clearing>` `<cry>` `<sob>` `<whimper>` `<whispers>` `<whispering>` `<shout>` `<scream>` `<yawn>` `<tsk>` `<pff>` `<phew>` `<argh>` `<grunt>` `<growl>` `<grr>` `<hiss>` `<pant>` `<snort>` `<sneeze>` `<shriek>` `<cheer>` |
| Backchannel | `\|oh hmm\|` inside the active speaker's turn — overlap/reaction, best on `flash-tts`; field reports hallucinated backchannels, test before use |
| Not available | mood/emotion tags (`<excited>`, `<angry>`) — mood is the `style` string's job |

**IU results:** `<short pause>`, `<long pause>`, `<laugh>`, `<sigh>` are accepted and never spoken
(transcript clean on every audition sample). `<long pause>` is clearly audible (+2.7 s on a two-sentence
probe); `[long pause]` square form adds ~1 s and `[friendly]`-style square tags are accepted but are the
legacy convention — **square brackets are tolerated, angle brackets are the contract**. Write tags in
English even inside German text (docs, field); never place two tags adjacent; keep one or two per few
sentences. Field: a valid `<short pause>` was read aloud as words on 2 of many takes — if a pause is
spoken, swap it for `<long pause>` or punctuation.

## Streaming

- `:streamGenerateContent?alt=sse` returns many small headerless PCM chunks (24 kHz mono s16le). IU:
  a 5 s clip on flash-lite finished streaming in 1.2 s total (first-audio numbers: table above);
  `responseFormat` `AUDIO_WAV` is still honoured on stream.
- A client reading progressively gets sound before synthesis ends; whole-file clients (Slack uploads)
  wait for the full body. Parse SSE `data:` lines → `candidates[0].content.parts[*].inlineData.data`
  (base64) — not every event carries audio.
- Unary: default WAV; ask `responseFormat.audio.mimeType: "AUDIO_L16"` for headerless PCM.
- Bidirectional (text-in-while-speaking) streaming is not offered; the Live API is a different product
  with different model ids.

## Limits and chunking

| Limit | Value | Source |
|-|-|-|
| Input / output tokens | 8,192 / 16,384 | docs |
| Max audio per request | ~655 s (16,384 ÷ 25) | docs (Cloud) |
| Quality drift | starts around 1.5–3 min of audio; on 3.8 a pitch/loudness seam at internal chunk boundaries (~every 1,900 chars, ~500 input tokens) | field |
| Truncation | silent cut-offs at ~20 s / ~60 s with `finishReason: OTHER` reported | field — not reproduced |
| Speakers | 2, prebuilt voices | docs |

**IU measurements (distinct German text, Charon):** 252 chars → 13 s; 519 → 28 s; 1,057 → 57 s on
`flash-tts` — word counts within 3 % of the transcript each time, no truncation. Rate ≈ 18 chars/s.
**Repeating the same paragraph** (a test artefact) made the model skip most of the text (heard 22 of 88
words, 119 of 176) — never loop identical text through TTS.

**Rule for our lanes:** chunk at sentence boundaries to ≤ ~1,000 chars (≈ 55 s), one request per chunk,
the same short `style` on every chunk, join with ~250 ms of silence, stitch as PCM before encoding.
Multi-speaker: ≤ ~3,000 chars per request (field: voice swaps grow with chunk length), keep the
same style string per speaker across requests.

## Pacing without a speed parameter

No rate field exists (docs, IU: nothing numeric). The levers, in order of reliability:
`style` (`"speaking slowly"`, `"calm, unhurried"`) → `<short pause>` / `<long pause>` → sentence length
and punctuation → post-processing with ffmpeg `atempo` (0.5–2.0 per stage, artefacts unmeasured).
ElevenLabs `speed` (0.94 / 1.0 per host) has no equivalent — encode host pace as a constant per-host
style string (`"warm, a little slower"`).

## Voices

All 30 prebuilt voices speak every language; voice sets timbre, not language. Labels from Google
Cloud (gender) and ai.google.dev (tone). Voice identity is **not pinned**: the same voice name can
sound slightly different run to run and across chunks (field); no seed fixes it (IU accepts `seed`,
no proof it pins anything). Mitigation is short chunks and a constant short style.

| Male | Tone | Female | Tone |
|-|-|-|-|
| Charon | Informative | Sulafat | Warm |
| Rasalgethi | Informative | Vindemiatrix | Gentle |
| Sadaltager | Knowledgeable | Kore | Firm |
| Iapetus | Clear | Despina | Smooth |
| Algieba | Smooth | Gacrux | Mature |
| Achird | Friendly | Erinome | Clear |
| Schedar | Even | Callirrhoe | Easy-going |
| Umbriel | Easy-going | Laomedeia | Upbeat |
| Orus, Alnilam | Firm | Achernar | Soft |
| Puck | Upbeat | Zephyr, Autonoe | Bright |
| Fenrir | Excitable | Leda | Youthful |
| Enceladus | Breathy | Aoede | Breezy |
| Algenib | Gravelly | Pulcherrima | Forward |
| Sadachbia | Lively | | |
| Zubenelgenubi | Casual | | |

The Extended Voice Library, voice design and replication are GA on the Gemini API (`/v1beta/voices`)
but **not reachable on IU** (see field map). The stack voice is **Charon** (owner decision 2026-10-25).
The 2026-10-25 audition (modelpick `/tts`, "Gemini 3.8 voice audition") renders Charon, five male
alternatives and eight female candidates through the chat, briefing and podcast pipelines.

## German

- Auto-detected, no `languageCode`. German is a first-class locale (`de-DE` GA on Cloud).
- 3.8 reads German well in independent tests. The only detailed German defect report is on a 2025
  preview model (mispronounced *dunkel*, *speichern*); IU audition transcripts are clean.
- **Spoken-form numbers are the caller's job.** Freeform text is spoken as written. Write numbers the
  way they are said: "Viertel nach neun", "vier Komma zwei Millionen Euro", "zweitausendsiebenundzwanzig".
  IU: raw digits (`14. November um 15:30 Uhr`) are read correctly most of the time but dropped "Uhr" in
  some voices (round-trip noise) — acceptable for chat, normalise for briefings and podcasts.
- Tags stay English; style strings may be English; the spoken text is German.
- Abbreviations (`z. B.`, `Mio.`, `€`) are not verified — expand them in prep.

## IU-vs-docs: things that bite

1. `temperature`/`seed` are accepted on IU even though docs say 3.8 rejects them — Google may close
   that door; don't build on it.
2. Streaming usage metadata is wrong (`1` token); bill from duration.
3. `sampleRate` in `responseFormat` is ignored for L16 (24 kHz fixed); mulaw/alaw honour 8 kHz.
4. Interactions API, voices endpoints and MP3 output do not exist on IU.
5. Multi-speaker needs per-part `speechMetadata.speaker`; the `Name:` prefix form fails with 400.
6. Spoken-prefix style (`Style: text`) is read aloud — remove it from any 3.1-era prep.

## How modelpick wires it

- `src/server/iu/probe.ts` — TTS probe routes Gemini-dialect models to `generateContent`.
- `src/server/audio/generate.ts` — playground `generateTts()`; the Gemini branch still carries the 3.1
  spoken-style prefix and square-tag presets. Playground-only; **not** the pattern to copy.
- `scripts/tts-compare.ts` — cross-model German comparison (`data/tts-compare/manifest.json`).
- `scripts/tts-audition.ts` — the 3.8 voice audition: same German material, same `style` and `<tag>`
  usage for every voice, each manifest row carries its exact request. Prototype 3.8 prep (spoken
  numbers → short sentence-aligned chunks → one constant `style` → `<short pause>`/`<long pause>` at the beats) is
  hard-coded there and is the contract the audio-gateway prep prompt implements.

## Sources

- Gemini speech generation — https://ai.google.dev/gemini-api/docs/speech-generation
- Gemini API changelog (2026-09-22 GA) — https://ai.google.dev/gemini-api/docs/changelog
- Gemini API pricing — https://ai.google.dev/gemini-api/docs/pricing
- Migration guide 3.1 → 3.8 (angle tags, `speech_metadata`, WAV default) — linked from the speech-generation guide
- Cloud TTS Gemini-TTS (legacy bracket-tag guide, limits) — https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
- Practitioner reports: Google AI developers forum threads on voice drift and truncation (2026-09/10),
  LiveKit 3.1 prompting guide (2026-04-27), Scenario 3.8 hands-on (2026-10-21)
