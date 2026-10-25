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
| Output, unary | `audio/wav`, 44-byte RIFF header | confirmed: 24 kHz mono s16le WAV **plus a trailing ~6 KB `C2PA` content-credentials chunk after `data`** — parse chunks, never slice 44 bytes (the tail plays as ~0.13 s of loud noise). `AUDIO_L16` returns none of this |
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

**Chunk length, measured (2026-10-25, `scripts/tts-wave5.ts --exp chunks`, flash, same distinct German
material per row, 250 ms joins; `data/tts-compare/wave5-chunks.json`, samples on `/tts` → Wave 5):**

| Lane | Chars / request | Requests | Audio | Dropped / added / wrong words | Speaker attribution | Loudness spread (10 s windows) | F0 spread |
|-|-|-|-|-|-|-|-|
| Two hosts (2,785 chars, 20 turns) | 1,000 | 3 | 157 s | 0 / 0 / 2 | 20/20 | 5.6 dB (max step 4.5) | n/a |
| | 1,500 | 2 | 156 s | 0 / 0 / 1 | 20/20 | 3.6 dB (2.5) | n/a |
| | 2,000 | 2 | 157 s | 1 / 0 / 3 | 20/20 | 4.0 dB (3.2) | n/a |
| | 3,000 | 1 | 158 s | 0 / 0 / 1 | 20/20 | 2.6 dB (2.1) | n/a |
| One voice, Charon (2,026 chars) | 1,000 | 3 | 118 s | 0 / 0 / 0 | n/a | 2.2 dB | 22 Hz |
| | 1,500 | 2 | 124 s | 0 / 0 / 1 | n/a | 3.1 dB | 13 Hz |
| | 2,000 | 2 | 105 s | 0 / 1 / 1 | n/a | 3.7 dB | 25 Hz |

Attribution = `gpt-4o-transcribe-diarize` on IU, every turn mapped to one consistent label per host.
Read: **no length up to 3,000 chars/158 s drifted, dropped words or swapped a voice** — the whole
two-host excerpt in one request was the most even (fewest seams, least loudness movement), and every
request boundary added a level step (largest at 1,000). F0 shows no trend with length (noise ±10 Hz).
Single-speaker pace varies by request: 155–182 wpm across the three runs, so a speed-sensitive lane
should not assume a constant rate. Not tested: requests above 3,000 chars/~3 min (the field-reported
drift zone) and the ~1,900-char internal seam — no seam showed up as a window step at 1,500–3,000.

**Rule for our lanes:** multi-speaker ≤ 3,000 chars per request (measured clean; fewer requests = fewer
level steps). Single speaker: sentence-aligned chunks ≤ ~1,000 chars, kept for first-byte latency and
retry cost, not quality (1,500–2,000 measured as clean). The same short `style` per chunk, ~250 ms of
silence join, stitch as PCM before encoding. Multi-speaker: same style string per speaker across requests.

## English terms in German speech (Wave 5, `--exp english`, `english-hint`)

No language tag exists. Four variants on Charon + Erinome (plain / style hint "English technical terms
and brand names are pronounced in English" / writer rule: English spelling, separate words, no German
compounds / both) judged by a `gemini-3.8-flash` listener (per-term english/mixed/german; noisy).
Repeating plain vs a short vs the long hint three times each (score = english terms out of 15, mixed = 0.5):
plain 9 / 8.5 / 7.5, long hint 8.5 / 0 / 5.5, short hint 2 / 0 / 5.5. **Run-to-run variance exceeds any
variant effect and neither hint beat plain** — Gemini already pronounces most terms (Claude Code,
GitHub, Deployment Pipeline, Pull Request) in English or a blend; the stragglers (Release, Cloud,
Monitoring, Grafana) stay German-ish whatever we do. Decision: no hint, no writer rule. Samples are on
`/tts` for the owner's ear; if one wins there, the lever is the style string (a one-line change).

## Numbers (Wave 5, `--exp numbers`)

Normalised digits (`3.8.1`, `14.11.2026 um 15:30 Uhr`, `1.299,50 Euro`, `12 Prozent`) and the fully
spelled-out form were both transcribed back identically on both voices and ran the same length (23–24
vs 24–26 s); the style "speaking slowly and clearly" stretched the spelled passage to 37–38 s (+55 %).
A rounded spoken form ("rund dreizehnhundert Euro", "gut ein Achtel weniger", "etwas über viertausend")
read correctly and ran 25 % shorter. So: digits are safe for the chat lane (`normalizeForSpeech`), spelling
out buys no accuracy, slow style is the pacing lever for dense passages (podcasts already use it), and
the cheapest win for data-dense text is rounding at the writer/prep step — the briefing prep prompt now says so.

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
7. **C2PA trailing chunk.** Unary WAV = header + `data` + `C2PA`. Strip-44-and-keep-the-rest plays the credentials as noise at the end of every clip (found by ear, 2026-10-25). Ask `AUDIO_L16`, or walk RIFF chunks and keep only `data`.

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
