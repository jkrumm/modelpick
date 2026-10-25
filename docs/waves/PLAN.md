# German STT comparison in /stt
**Goal:** `/stt` on :7727 shows a measured German speech-to-text comparison — every IU-reachable cloud STT plus
the local MacWhisper engines on the MacBook — with WER against reference transcripts, punctuation/casing
quality, long-form robustness, diarization, latency and $/min, and `docs/decisions/audio-stack.md` carries a
per-use recommendation (Hermes voice messages, MacWhisper dictation, long recordings) pending Johannes' verdict.
**Gate:** `make check`, then `make deploy` + `make verify`. IU spend cap **$1**.

## Established — do not re-derive
- Current setup: **remote** = audio-gateway STT `gpt-transcribe` (US-routed OpenAI leg; `whisper` (EU) kept for
  timestamps); **local** = MacWhisper on the MacBook with `qwen3-asr-1.7b` (also downloaded: `nvidia_parakeet-v3`,
  WhisperKit `openai_whisper-large-v3-v20240930`). MacWhisper's "custom" cloud provider still points at an MLX
  Whisper endpoint on the MacBook's tailnet host — likely stale (retired audio-proxy); report whether it works.
  MacWhisper CLI: `ssh iumac /Applications/MacWhisper.app/Contents/MacOS/mw` (docs: docs.macwhisper.com
  article 57). Use it for the local engines; do not change MacWhisper settings.
- IU-reachable (today's `capability_probe`): `gpt-transcribe`, `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`,
  `whisper` (EU), `elevenlabs/scribe-v2` (Replicate, URL-in), `voxtral-small-transcribe-3-0`,
  `voxtral-mini-transcribe-3-0` (Mistral La Plateforme, launched 2026-10-20), `xai/grok-speech-to-text`.
  `gemini-3.5-transcribe` timed out in the probe — find the right request shape (Gemini transcribe guide) and
  include it if it works. OpenAI shuts down `gpt-4o-*transcribe*` and `whisper-1` on 2027-02-26.
- Research (2026-10-25, research-gateway job f80b9661): the only German leaderboard number is Scribe v2 2.27% vs
  Whisper large-v3 4.26% (Open ASR German = MCV-de + FLEURS-de, normalised: no punctuation/casing).
  gpt-transcribe: $0.0045/min, no German WER, no diarization, no word timestamps, prompt-only formatting.
  Voxtral Small Transcribe 3: $0.0040/min, FLEURS-45 macro 4.1%, best diarization cpWER (18.4%), EU-hosted.
  gemini-3.5-transcribe: ~$0.005/min, ITN + punctuation, diarization ≤8 speakers, 30-min cap with diarization.
  Scribe v2: word timestamps + diarization, price unverified. Local ranking (Qwen3-ASR vs Parakeet v3 vs
  WhisperKit large-v3 for German) is NOT researched — measure it.
- Residency rule (audio-stack.md): recorded **personal** voice should stay EU. Therefore use **public German
  test audio with reference transcripts** only — no personal recordings.

## Wave 1 — Measure and present            <!-- status: done -->
- [x] Test set (public, with references): ~15 FLEURS-de / Common Voice-de clips (short, dictation-like), one
      ~10–15 min long-form German recording with an official transcript (e.g. a Bundestag plenary excerpt —
      multi-speaker, for diarization and drift), one noisy/phone-quality clip. Record sources + licences
- [x] Run every reachable cloud model (sensible German settings: language `de`, diarization where offered) and
      the three local MacWhisper engines. Metrics: normalised WER (Open ASR-style) AND raw WER with
      punctuation/casing, number/date formatting, long-form repetition/truncation, diarization (speaker
      count / cpWER where possible), latency (RTF), $/min (cite source), residency
- [x] `/stt` page section: per-model table + per-clip transcript diff view (reference vs hypothesis), audio
      playable. Reuse the request-time audio route pattern from `/tts`
- [x] "How to call it" per model (request shape, language/diarization params, limits, traps)
- [x] Decision record section in `docs/decisions/audio-stack.md`: results table + recommendation per use
      (Hermes voice messages via audio-gateway; MacWhisper dictation local; long multi-speaker recordings),
      marked pending the owner's verdict; note whether audio-gateway could swap STT by config alone
- [x] Gate green, committed, pushed, deployed, verified; report actual spend
**Left behind:** stopped: plan complete. Pushed and deployed; `/stt` live on :7727 (`make verify` green). IU spend ≈ $0.83
of $1 (list-price estimate). Recommendation in `docs/decisions/audio-stack.md` is pending Johannes' verdict; nothing changed in audio-gateway.
- Deviations: long-form is a single-narrator LibriVox reading (Schimmelreiter, Gutenberg text), not a multi-speaker Bundestag excerpt
  (no scriptable audio+transcript source found); diarization is scored on the synthetic two-host `/tts` clip. Noisy clips are
  FLEURS clips degraded with ffmpeg. Short set is 244 words, noisy 44 — differences under ~1 point are ties.
- `gpt-4o-transcribe-diarize` failed the 12-min clip (HTTP 500); `gemini-3.5-transcribe` works only on the Gemini route with no speaker labels.
  whisper latencies include rate-limit backoff and are blanked where obvious.
- Pre-existing, untouched: `make check` lint fails on master in `scripts/tts-audition.ts` (unused import) and `scripts/tts-wave5.ts`
  (2 errors); tests (884) and typecheck pass. `fallow audit` flags complexity in the new `-stt-compare.tsx` / `stt-compare.ts` and old `stt.tsx`.
- Review items not done: shared Levenshtein table across `wer`/`alignHyp`/`diffTokens`; `score()` options object; runner has no unit tests.
