# Podcast writer — a role split with one voice owner

**Decision (2026-09-02, third revision the same day):** audio-gateway's podcast pipeline
(`POST /v1/podcasts`, the "writers' room" in `src/podcast-script.ts`) uses one model per role,
all on the IU endpoint:

| Role | Env | Model | Why |
|-|-|-|-|
| Story pass: through-line, hook, reveals, digressions, segments | `PODCAST_OUTLINE_MODEL` | `claude-opus-5` | Smartest structural thinker on the endpoint; holds long arcs. Reasons long (1.4k tokens even on a toy task) — fine for one call per episode. Not allowed near dialogue. |
| **Voice owner**: segment writers, every revision and tightening pass | `PODCAST_WRITE_MODEL` | `claude-opus-4-6` | Writers' consensus for organic, human-sounding German dialogue; fewer Claude-isms than Opus 5. No other model ever writes or rewrites a line. |
| Reviewers (3 lenses × each model, parallel, notes only) | `PODCAST_REVIEW_MODELS` | `gemini-3.1-pro-preview,gpt-5.6-luna` | A different lab's model finds different faults (AI-isms, essay sentences, pace, facts); Gemini for structure critique at $12/M out, Luna cheap and fast. Advisory: they point, they don't draft. |
| Metadata: title, show notes, cover prompt, chapter titles | `PODCAST_METADATA_MODEL` | `gpt-5.6-luna` | Volume work, cheap, fast, good German. |
| Escalation only | — | `claude-fable-5-1` | Strongest writer/knowledge model but $10/$50 per M; only if a complex episode's outline or voice misses. Not a default. |

A **show bible** (`docs/show-bible.md`, `PODCAST_SHOW_BIBLE`) is injected into every writer and
reviewer prompt: tempo, forbidden phrases and AI-isms, how the two hosts speak, the structure that
has worked. A style anchor beats model-hopping.

## How we got here (same day)

1. `claude-sonnet-5` everywhere — first default; outside the creative top ten on both boards.
2. `claude-opus-5` + `claude-fable-5-1` — leaderboard pick (EQ-Bench Creative Writing v3 #1 /
   LMArena creative #1). Owner: "people hate on Opus 5's prose". A practitioner-weighted research
   pass agreed: Opus 5 runs longer, metaphor-heavy, over-explains (Anthropic's own prompting guide
   says outputs are longer than prior Opus); writers name Opus 4.6 for voice; Fable is overkill.
3. `claude-opus-4-6` for everything — one voice, but structure and review by the same model.
4. This split — matches the owner's Perplexity research (Sept 2026): "cheap research, expensive
   only for structure, speakable writing, one foreign model reads back; no third model rewrites
   the tone; multi-model averaging makes the episode smoother and faceless — a second pass only
   wins with a clear task".

Evidence snapshot 2026-09-02: EQ-Bench v3 Elo — opus-5 2116 (#1), kimi-k3 2071, GLM-5.3 2062,
gpt-5.6-sol 1964, fable-5 1933 (#6), sonnet-5 not in top 10. LMArena creative — fable-5 #1
(1505±9), opus-5-high #10, sonnet-5-high #50. Kimi/GLM: no prose evidence anywhere. German
dialogue: no comparison exists for any current model; the Spain episode Fassung 1–6 in
Audiobookshelf are the listening test. Output prices per M: Opus 5/4.6 $25, Sonnet 5 $10, Fable
5.1 $50, Gemini 3.1 Pro $12–18, Luna cheap.

## Cost and what to watch

- Per 22-minute episode: ~$1 outline (Opus 5 reasoning), ~$2–3 writing + revisions (Opus 4.6),
  ~$0.5 reviews (6 calls), cents for metadata, ~$2 ElevenLabs v3. Measure cost per accepted
  episode, not per token — Opus 5 thinks by default and lands above its list price.
- Claude reasons invisibly on the heavy prompts; `writerBudget()` carries 16k headroom and
  doubles on the parse-failure retry. `llm.finish_reason=length` on a writer span means the
  budget, not the model.
- No `reasoning_effort` cap anywhere: measured 8.7k → 4.8k completion tokens for the same text
  with `low`, rejected on the owner's call (no time pressure, deliberation is what we pay for).
- Re-pick triggers: a German dialogue eval appearing; EQ-Bench Longform moving; Opus 4.6 retired
  on IU; a reviewer model consistently producing notes the writer ignores (then drop it).
