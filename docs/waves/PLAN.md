# /tts as a listening workbench
**Goal:** Johannes opens `/tts` on :7727 and immediately knows what each sample is, what to compare it with,
and which question his ears are answering — then records a pick per question. Today the page is three
sections of wide metric tables keyed by ids like `w5__english__Charon__b-style`; he can't tell what differs.
**Gate:** `make check`, then `make deploy` + `make verify`. **No IU spend** — reuse the existing audio and
`data/tts-compare/manifest.json`; generate nothing.

## Established — do not re-derive
- Data: `data/tts-compare/manifest.json` (`texts` + 126 `samples`; fields id, preset, model, voice, gender,
  file, mode, set ∈ {none, audition, wave5}, request, latency_ms, first_audio_ms, duration_s, chars,
  cost_per_min, cost_source, verbatim, diff, streaming, aa_rank). Audio served by `src/routes/api.tts-audio.$name.ts`.
  UI today: `src/routes/-tts-compare.tsx` (`TtsCompare`, `CompareSection`, `SampleTable`), mounted in
  `src/routes/tts.tsx`; loader in `src/server/audio/compare.ts`.
- Decisions already made (show as "settled", not as open questions): Gemini 3.8 everywhere — chat
  `gemini-3.8-flash-lite-tts`, briefings + podcasts `gemini-3.8-flash-tts`; voices **Charon** (main/male host)
  and **Erinome** (female co-host). Chunking: briefing chunks ~1,100 chars, podcast multi-speaker runs ≤3,000
  chars — W5 found no drift 1,000–3,000. Numbers: production prep spells numbers out and rounds statistics
  (variants b + d). English terms: nothing shipped yet (production = variant a, plain).
- **Open questions for his ears** (the reason for this wave):
  1. English terms in German speech — `w5__english__<voice>__{a-plain,b-style,c-rule,d-rule+style}`:
     a = text as written; b = style hint telling the model to pronounce English terms in English;
     c = writer rule: English compounds written open, no hyphens ("Pull-Request" → "Pull Request", "Deployment-Pipeline"
     → "Deployment Pipeline"; texts `w5_english_a` vs `w5_english_c`);
     d = c + b. Same model (flash), same text otherwise, per voice Charon and Erinome.
  2. Numbers and data — `w5__numbers__<voice>__{a-digits-normalized,b-spelled,c-spelled-slow,d-rounded}`:
     a = digits, symbols normalised (€ → Euro, % → Prozent; `w5_numbers_raw`); b = every number spelled out;
     c = b with style "speaking slowly and clearly"; d = rounded and spelled ("rund dreizehnhundert Euro", "Mitte November").
  3. (Check, not a choice) chunk length — `w5__chunks__{mono,duo}-{1000,1500,2000,3000}`: same material at
     different chars per request; listen for drift at the end of long chunks.
- Reference material (collapsed by default): the German cross-model comparison (set none; chat/briefing/
  podcast × 10 models) and the Gemini voice audition (set audition). Keep blind mode for the model comparison.
- Each sample's exact input is in `request` — use it to show what text/style the variant actually sent.

## Wave 1 — Rebuild /tts around questions            <!-- status: active -->
- [ ] An experiments definition (typed, in code, e.g. `src/server/audio/experiments.ts`) mapping manifest ids
      to: question (plain language), what is held constant, the axis that varies, a human label + one-line
      description per variant (A "As written", B "Style hint: English terms in English", …), which variant is
      in production now, and rows (voice). No id strings in the UI
- [ ] Layout top to bottom: (1) "Your picks" summary — one line per open question with the chosen variant,
      plus a "copy as text" button so he can paste the verdict into chat; (2) open-question cards;
      (3) "Check" card for chunk length; (4) collapsed "Reference: settled decisions" with the model
      comparison (blind mode) and the voice audition, each with a one-line note on what was decided
- [ ] Question card: question as title; one sentence "same: model, voice, text — differs: …"; the spoken text
      once, with the differing span highlighted per variant where the input text differs (english a vs c,
      numbers raw vs spelled); a grid rows = voice, columns = variants; each cell: big play/pause button,
      label, duration, "in production" badge where applicable, and a "pick" toggle (one pick per question,
      persisted in localStorage)
- [ ] Playback: one global player — starting a sample stops any other; keyboard 1–4 plays variant A–D of the
      focused card row, space pauses. Metrics (latency, $/min, AA rank, streaming, transcript diff) only in the
      reference model comparison, compact, with plain-language column tooltips
- [ ] Keep it in the repo's UI conventions (Mantine, existing components; read AGENTS.md). Remove the old
      `CompareSection` tables for set audition/wave5 once the new view covers them
- [ ] Gate green; `make deploy` + `make verify`; confirm `/tts` returns 200 and every referenced audio file
      resolves (script or curl loop over the manifest); commit per concern, push
**Left behind:**
