# Gemini 3.1 Flash TTS

`gemini-3.1-flash-tts-preview` is Google's expressive text-to-speech model. On the
IU gateway it is **EU-resident** (routed through the "GDPR ONLY" Gemini gateway).
modelpick uses it for the TTS playground demos; the `audio-gateway` service
(`~/SourceRoot/audio-gateway`, VPS Docker container) productionizes the same
prep-then-synth pattern to give Hermes longform expressive TTS over an
OpenAI-compatible `/v1/audio/speech`.

## Why it needs a special route

Gemini TTS is **not** served on the OpenAI-compatible `/audio/speech` endpoint —
that route returns `404 NotFound` for every Gemini voice model. TTS only answers
on the **native `generateContent`** endpoint with an `AUDIO` response modality.
This is why the generic OpenAI path used by `tts`/`tts-hd`/`gpt-4o-mini-tts` does
not work for Gemini, and why `generateTts()` branches on the provider dialect.

| | OpenAI TTS (`tts`, `gpt-4o-mini-tts`) | Gemini TTS |
|-|-|-|
| Endpoint | `POST /audio/speech` | `POST /models/{id}:generateContent` |
| Voice selection | `voice: "alloy"` (param) | `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` |
| Expression control | `instructions` field (4o-mini-tts only) | natural-language style **in the prompt** + inline tags |
| Output | MP3 bytes | base64 **PCM L16, 24 kHz, mono** in `inlineData.data` |
| Languages | fixed per model | 70+, auto-detected from the text |

## Request shape

```
POST {IU_GEMINI_BASE_URL}/models/gemini-3.1-flash-tts-preview:generateContent
Authorization: Bearer $IU_API_KEY
Content-Type: application/json
```

```json
{
  "contents": [{ "parts": [{ "text": "Say warmly: Good morning, here is your briefing." }] }],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "temperature": 1.0,
    "speechConfig": {
      "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Charon" } }
    }
  }
}
```

The audio comes back base64-encoded as raw PCM — no container. To play it in a
browser `<audio>` element, prepend a 44-byte WAV header (1 channel, 24000 Hz,
16-bit). modelpick does this in `pcmToWav()` (`src/server/audio/generate.ts`);
the `mimeType` (`audio/L16;rate=24000`) is parsed to pick up the sample rate.

```
candidates[0].content.parts[0].inlineData = {
  mimeType: "audio/L16;codec=pcm;rate=24000",
  data: "<base64 PCM>"
}
```

## Controlling expression

There is no separate "style" field — **the delivery instruction and the spoken
text share one prompt**. Everything before the line you want spoken is treated as
direction; Gemini speaks only the transcript.

Two mechanisms, combinable:

1. **Natural-language direction** — prepend a sentence describing tone, pace,
   emotion, or accent. `gemini-3.1-flash-tts-preview` supports "director's-chair"
   prompting (per-character audio profiles), not just a single adjective.
2. **Inline audio tags** — bracketed cues inside the text. Gemini 3.1 added 200+
   expressive tags (`[whispers]`, `[laughs]`, `[excited]`, `[sighs]`, `[sarcastic]`,
   pauses, …). Place a tag immediately before the phrase it should affect.

```
Read this as a calm, warm narrator, slightly slower than normal:
The results are in. [pause] And they exceeded every expectation.
```

`temperature` (range `0.0`–`2.0`, default ~`1.0`) varies prosody — lower is
steadier, higher is more varied. Input context is 32k tokens; a single request
generates up to ~655 s (~10.9 min) of audio.

## The 30 prebuilt voices

Google Cloud TTS labels each voice's perceived gender (the ai.google.dev page only
lists the character descriptor). The split is ~16 male / ~14 female. `M`/`F` below
is the Cloud-docs gender; the descriptor is from ai.google.dev.

**Male (M):**

| Voice | Character | Voice | Character |
|-|-|-|-|
| Charon | Informative | Rasalgethi | Informative |
| Schedar | Even | Sadaltager | Knowledgeable |
| Iapetus | Clear | Achird | Friendly |
| Algieba | Smooth | Umbriel | Easy-going |
| Orus | Firm | Alnilam | Firm |
| Puck | Upbeat | Fenrir | Excitable |
| Enceladus | Breathy | Algenib | Gravelly |
| Sadachbia | Lively | Zubenelgenubi | Casual |

**Female (F):**

| Voice | Character | Voice | Character |
|-|-|-|-|
| Sulafat | Warm | Vindemiatrix | Gentle |
| Kore | Firm | Zephyr | Bright |
| Leda | Youthful | Aoede | Breezy |
| Callirrhoe | Easy-going | Autonoe | Bright |
| Despina | Smooth | Erinome | Clear |
| Laomedeia | Upbeat | Achernar | Soft |
| Gacrux | Mature | Pulcherrima | Forward |

All voices speak all languages — voice choice sets timbre/character, not language.

## Recommended voices for Johannes (Hermes persona)

Hermes is **concise, warm, conversational — no greetings, substance first**, with a
*calm, sharp-older-friend* tone. The brief: **calm, middle-aged adult MALE voice,
pleasant medium-low (not too deep) pitch, easy to listen to, good in German.** That
rules out every female voice (`Sulafat`, `Kore`, `Zephyr`, …) — they read too
high/bright for this persona.

Default: **`Charon` (Informative)** — clear, even, unforced, the classic
narrator-you-want-to-listen-to. The playground generates the **full
voice × preset × language matrix** over this candidate shortlist so they can be
A/B'd directly (group by Speaker to hear one voice across styles, or by Preset to
hear all voices on the same line):

- **`Charon` (Informative)** — clear, neutral; the default.
- **`Iapetus` (Clear)** / **`Algieba` (Smooth)** — clear / smooth narration.
- **`Rasalgethi` (Informative)** — close to Charon, slightly fuller.
- **`Sadaltager` (Knowledgeable)** — warm, relaxed, conversational; podcast host.
- **`Achird` (Friendly)** — a touch more personable for interactive replies.
- **`Umbriel` (Easy-going)** — laid-back, unhurried.

`Orus` (Firm) and `Schedar` (Even) are excluded — too stiff for this persona — as
are the high-energy males (`Fenrir` Excitable, `Puck` Upbeat) and gravelly
`Algenib`. All female voices are excluded by the brief.

## German vs English

German is fully supported and auto-detected — no `language_code` needed; the model
infers language from the transcript. Keep the **direction in the same language as
the transcript** for the most natural delivery. Numbers and times read most
naturally when written the way they should be spoken (matching Hermes' briefing
convention: "Viertel nach neun", "neunzig Kilo").

| Intent | English prompt | German prompt |
|-|-|-|
| Neutral narration | `The quarterly results are ready for review.` | `Die Quartalsergebnisse stehen zur Durchsicht bereit.` |
| Expressive | `Say with bright, genuine excitement: We hit every target this month!` | `Sprich mit echter, lebhafter Begeisterung: Wir haben diesen Monat jedes Ziel erreicht!` |
| Hermes briefing | `Read as a warm, conversational narrator, no greeting: Three meetings today, the first at quarter past nine.` | `Lies als warmer, ruhiger Erzähler, ohne Begrüßung: Heute drei Termine, der erste um Viertel nach neun.` |
| With inline tags | `[thoughtful] Let me check that. [pause] Yes — the deploy is healthy.` | `[nachdenklich] Lass mich nachsehen. [pause] Ja — das Deployment läuft sauber.` |

> German tip: the expressive style words matter. `lebhaft`/`begeistert` lift the
> delivery; `ruhig`/`sachlich` keep it calm and factual for data-heavy briefings.

## Inline expression tags

Two complementary controls steer delivery:

1. **Style directive** — a leading natural-language instruction (`Read in a calm but
   firm tone:`) that sets the *overall* tone for the whole utterance.
2. **Inline tags** — bracketed cues placed *within* the text (`[pause]`,
   `[chuckles]`) that act at a *specific point*. They are performance cues, not
   spoken words — the model acts them out rather than reading the brackets aloud.

The playground demos use both: every non-`standard` preset carries a style directive
and a couple of inline tags, shown highlighted under each clip so the cue lines up
with what you hear.

| Tag (EN) | Tag (DE) | Effect |
|-|-|-|
| `[pause]` | `[pause]` | a short beat / breath |
| `[chuckles]` | `[lacht]` | a light laugh |
| `[sigh]` | `[seufzt]` | an audible sigh |
| `[excited]` | `[begeistert]` | lift energy from here on |
| `[thoughtful]` | `[nachdenklich]` | slower, reflective |
| `[firm]` | `[bestimmt]` | more controlled / assertive |
| `[whispers]` | `[flüsternd]` | drop to a whisper |

Notes & caveats:

- Tags are **model-dependent and best-effort** — Gemini honours common ones well,
  but exotic tags may be ignored (never read aloud) rather than performed. Keep the
  vocabulary simple and test.
- Write the tag in the **same language as the transcript** for the most reliable
  result (`[lacht]` in German, `[chuckles]` in English).
- A style directive applies broadly; inline tags pin a moment. Use both together —
  e.g. `Read as a warm narrator: … [pause] … [thoughtful] …`.
- Don't over-tag. One or two cues per few sentences reads naturally; a tag every
  clause sounds mechanical.

## Multi-speaker (dialogue)

For two speakers, swap `voiceConfig` for `multiSpeakerVoiceConfig` and label lines
in the transcript:

```json
{
  "contents": [{ "parts": [{ "text": "Anna: Wie war dein Tag?\nBen: Produktiv, danke!" }] }],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": {
      "multiSpeakerVoiceConfig": {
        "speakerVoiceConfigs": [
          { "speaker": "Anna", "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Vindemiatrix" } } },
          { "speaker": "Ben",  "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Charon" } } }
        ]
      }
    }
  }
}
```

## How modelpick wires it

- **`src/server/iu/probe.ts`** — TTS probe routes Gemini-dialect models to
  `generateContent` (the OpenAI route 404s), so accessibility is classified
  correctly.
- **`src/server/audio/generate.ts`** — `generateTts()` branches on the provider
  dialect; the Gemini branch prepends the style directive, sends `AUDIO` modality,
  and wraps the PCM in WAV via `pcmToWav()`. Default voice `Charon` (male).
- **`src/server/audio/presets.ts`** — two independent dimensions: `TTS_PRESETS`
  (text + `style` + inline tags per category × EN/DE) and `TTS_CANDIDATE_VOICES`
  (the calm adult-male shortlist). `scripts/seed-demos.ts` generates the full
  voice × preset × language matrix from them.
- **`src/routes/-audio-server-fns.ts`** — `generateTtsDemoFn` threads `voice` +
  `style` into `generateTts` and persists `voice` on the demo row; Gemini TTS is
  marked EU-resident in `EU_TTS_MODELS`.
- **`src/routes/tts.tsx`** — the playground filters by language / preset / voice,
  groups by Speaker or Preset for A/B comparison, and highlights inline tags.

## Sources

- Gemini speech generation — https://ai.google.dev/gemini-api/docs/speech-generation
- Gemini 3.1 Flash TTS announcement — https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-tts
- OpenAI compatibility (no TTS) — https://ai.google.dev/gemini-api/docs/openai
- Rate limits — https://ai.google.dev/gemini-api/docs/rate-limits
