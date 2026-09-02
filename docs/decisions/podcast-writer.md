# Podcast writer — Opus 4.6 writes and reviews

**Decision (2026-09-02, revised the same day):** audio-gateway's podcast pipeline
(`POST /v1/podcasts`, the "writers' room" in `src/podcast-script.ts`) writes **and** reviews with
**`claude-opus-4-6`** on the IU endpoint (`claude-opus-4-6-eu` exists if residency matters).
No `reasoning_effort` cap on any stage. Superseded within hours: `claude-sonnet-5` (first
default), then `claude-opus-5` + `claude-fable-5-1` (leaderboard pick, see below).

## Why not the leaderboard winner

The episode is not latency-bound and the script *is* the product, so the first re-pick went to
the top of the creative-writing boards (research-gateway, 2026-09-02):

| Model | EQ-Bench Creative Writing v3 (Elo, snapshot 2026-09-01) | LMArena creative (Sep 2, 2026) | Output $/M |
|-|-|-|-|
| claude-opus-5 | #1, 2116 | #10 as `-high` | 25 |
| kimi-k3 · GLM-5.3 · gpt-5.6-sol | #2 · #3 · #4 | #24 · #15 · #9 (all as `-max`/`-xhigh`) | 15 · 4.4 · — |
| claude-fable-5 | #6 | **#1** | 50 (as 5.1) |
| claude-sonnet-5 | outside top 10 | #50 | 10 |

The owner pushed back ("people hate on Opus 5's prose"), and a second, practitioner-weighted
research pass (Reddit, HN, writer blogs/YouTube, Anthropic's own docs) agreed:

- **Opus 5 is longer and more ornate by default** — dense sentences, metaphor, coined jargon,
  explained emotion, "expert revealing an insight" structure; Anthropic's prompting guide for
  Opus 5 states outputs run longer than prior Opus and that lowering effort does not reliably
  shorten them. Complaints are widespread (HN threads, novelcrafter, dev.to), with dissenters.
- **Opus 4.6 is the version writers name** for organic, human-sounding voice and dramatic
  dialogue (direct comparisons vs GPT-5.4 and Gemini 3.1 Pro; a fiction practitioner switched
  back from 5 to 4.6). One judged benchmark (novelmint) disagrees and scores Opus 5 highest on
  dialogue — treat the preference as a strong tendency, not a law.
- **Kimi K3 / GLM-5.3** have no prose evidence at all in the wild — intelligence/cost
  comparisons only; GLM is described as verbose. Not worth a seat without a listening test.
- **No German dialogue evidence** exists for any current model. The only German-language
  review found is old (GPT-4o / Claude 3.5 era). So this remains a listening-test question;
  Fassung 1–5 of the Spain episode in Audiobookshelf are that test.
- **Reviewer seat:** the practitioner pattern is "Gemini for architecture, Claude for
  line-level"; the reviewers here output notes, not prose, so the same Opus 4.6 does the job.
  Fable 5.1 at $50/M output with hidden reasoning (~$2–3 per episode) was dropped.

## Cost and what to watch

- ~$3–4 writer + reviewer tokens per 22-minute episode on top of ~$2 ElevenLabs v3 characters.
- Claude reasons invisibly on the heavy prompts (source + outline + draft ≈ 10–25k input
  tokens); it counts against `max_completion_tokens`. `writerBudget()` carries 16k headroom and
  doubles on the parse-failure retry; `llm.finish_reason=length` on a writer span means the
  budget, not the model, is the problem.
- Re-pick triggers: a German dialogue eval appearing anywhere; EQ-Bench Longform (the closest
  task shape) moving; Opus 4.6 being retired on the IU endpoint.

## Rejected

- **`reasoning_effort: low` on writing stages** — measured 8.7k → 4.8k completion tokens for the
  same text, so it works, but the owner's call is no time pressure and deliberation is what we
  pay for.
- **Opus 5 / Fable 5.1** — see above; Opus 5 remains a knob (`PODCAST_SCRIPT_MODEL`) and Fassung 4
  of the Spain episode was produced with it for comparison.
- **gpt-5.6-luna** (the Hermes brain) — fast and EU-resident, but not a writing pick anywhere.
