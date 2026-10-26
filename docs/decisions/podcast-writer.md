# Podcast writer — a role split with one voice owner

> **Current verdict (2026-10-26):** the role split holds. Estate default `deepseek-v4.1-flash` at
> `reasoning_effort: high` writes outline, editorial, metadata and research; `claude-opus-5-5`
> (`PODCAST_WRITE_MODEL`) is the sole voice owner; reviewers are `gemini-3.8-flash,deepseek-v4.1-flash`;
> narration is `gemini-3.8-flash-tts` (Charon + Erinome), not ElevenLabs. Whether Opus stays the voice owner
> is **open pending the owner's blind listening** (2026-10-26 bake-off below, `/tts` → "Podcast writer").
> The body of this record is the 2026-09-02 history (it names `claude-opus-4-6`, `gpt-5.6-luna` and
> ElevenLabs v3; those are superseded). Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

**Decision (2026-09-02, third revision the same day):** audio-gateway's podcast pipeline
(`POST /v1/podcasts`, the "writers' room" in `src/podcast-script.ts`) uses one model per role,
all on the IU endpoint:

| Role | Env | Model | Why |
|-|-|-|-|
| Story pass: through-line, hook, reveals, digressions, segments | `PODCAST_OUTLINE_MODEL` | `claude-opus-5` | Smartest structural thinker on the endpoint; holds long arcs. Reasons long (1.4k tokens even on a toy task) — fine for one call per episode. Not allowed near dialogue. |
| **Voice owner**: segment writers, every revision and tightening pass | `PODCAST_WRITE_MODEL` | `claude-opus-4-6` | Writers' consensus for organic, human-sounding German dialogue; fewer Claude-isms than Opus 5. No other model ever writes or rewrites a line. |
| Reviewers (3 lenses × each model, parallel, notes only) | `PODCAST_REVIEW_MODELS` | `gemini-3.8-flash,gpt-5.6-luna` | A different lab's model finds different faults (AI-isms, essay sentences, pace, facts); Gemini for structure critique, Luna cheap and fast. Advisory: they point, they don't draft. 3.1 Pro Preview at $12/M out was overkill for an advisory pass — swapped for 3.8 Flash the same day (audio-gateway `612f895`). |
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

## Researcher role (2026-09-07)

Podcast v2 added a tool-calling **researcher** in front of the writers' room (brain
search/read, past episodes, past transcript, research-gateway; `PODCAST_RESEARCH_MODEL`).
Live `benchmark-tool-calling.ts` run, 2026-09-07, same 3-tool scenario:

| Model | Tools | Final answer | Wall | $/M in → out |
|-|-|-|-|-|
| `gpt-5.6-terra` | 3/3 | yes | 4.3 s | 2.00 → 12.00 |
| `gpt-5.6-sol` | 3/3 | yes | 5.3 s | 4.00 → 20.00 |
| `gpt-5.6-luna` | 3/3 | yes | 5.6 s | 0.20 → 1.20 |
| `DeepSeek-V4-Pro` | 3/3 | yes | 17.0 s | — |
| `glm-5.3-flash` | 3/3 | yes | 26.2 s | 0.075 → 0.25 |
| `gemini-3.8-flash` | 2/3 | no | 10.3 s | 0.75 → 3.75 |

**Decision: `gpt-5.6-terra`.** The role is judgment (what is worth looking up, what the
listener doesn't know) over ~7–12 rounds and ~60k input tokens per episode — at Terra's
price that is ~$0.15 per episode, so cost does not rank the candidates; speed and tool
reliability do, and Terra leads both. Sol is the quality ceiling but 20× Luna's output
price for no measured tool advantage; Gemini 3.8 Flash is flaky on tools in this shape
(see gemini-tool-calling-shapes.md); the open-weight models are 3–6× slower. Luna
(the 2026-09-06 first pick) stays the metadata/review workhorse.

## Writer bake-off (2026-10-26) — verdict pending the owner's blind listening

**Why:** `podcast-segment` on `claude-opus-5-5` cost $3.41 of the last Gemini test episode while all
audio cost $0.10; writing is the dominant podcast cost. **Method** (`audio-gateway`
`scripts/writer-bakeoff.ts`): one episode ("Factory v2.2"), one frozen outline, then per candidate the
production per-segment flow — draft → production reviewer panel → the candidate's own revision/tightening —
for two segments (the opening and "Blog und Code", the segment with the most host interaction),
voiced with the production Gemini 3.8 multi-speaker path. Only the voice owner differs. Listen blind at
`/tts` → "Podcast writer" (letters only; "reveal writers" shows model, cost and script stats).

| Writer | $/M out | Writer cost / 20-min episode | Words / target (opening / interaction) | Draft + revision wall | Tag violations | Revised |
|-|-|-|-|-|-|-|
| `claude-haiku-5-5` | 0.5 | $0.07 | 368/460 / 465/500 | 93 s | 0 | 2/2 |
| `deepseek-v4.1-flash` | 1.2 | $0.11 | 444/460 / 412/500 | 85 s | 0 | 2/2 |
| `gpt-6-sol` | 10 | $0.37 | 420/460 / 507/500 | 29 s | 0 | 2/2 |
| `grok-4.7` | 6 | $1.71 | 424/460 / 482/500 | 738 s | 0 | 2/2 |
| `claude-opus-5-5` | 20 | $1.73 | 401/460 / 490/500 | 92 s | 0 | 2/2 |
| `glm-5.3` | 4.4 | $2.10 | 420/460 / 599/500 | 1290 s | 0 | 1/2 |
| `kimi-k3` | 16 | $4.47 | 412/460 / 536/500 | 1509 s | 0 | 2/2 |
| `claude-sonnet-5-5` | 10 | — | — | — | — | failed |

Cost is **list price** (input and output tokens from the usage ledger, cache discounts ignored) scaled from
the two measured segments to the outline's five by target words, revisions at the measured share. The
measured 2026-10-25 Opus episode cost $3.41 for the writer; the projection for Opus lands at ~$1.7 because
the bake-off ran a single revision pass over 2 of 5 segments and the real episode ran more calls (24).
Compare candidates with each other, not against $3.41. Prices: Anthropic and gpt-6-sol from their pricing
pages (2026-10-25), grok-4.7 from OpenRouter, glm-5.3 from Z.ai, deepseek-v4.1-flash at the peak rate,
kimi-k3 from OpenRouter (Moonshot's own table did not render). Both reviewer models are shared and not part
of the writer cost.

**Findings that do not need ears:**

- `claude-sonnet-5-5` failed the harness: its segment draft came back as a `[A] …` screenplay instead of the
  required JSON object, twice (the production retry). In production that fails the job. No audio exists for it.
- `glm-5.3` and `kimi-k3` reason for minutes per segment (glm ~250–500 s per call, ~45k output tokens for a
  500-word segment) — 15–25 min wall for two segments, against 30–90 s for the rest. glm's second segment
  stayed a draft because the revision came back empty twice; it also ran 20% over target.
- `gpt-6-sol` is by far the fastest and cheapest of the strong models: 29 s wall, ~$0.37 / episode.
- `grok-4.7` ran through OpenRouter (list $2 / $6), not IU.
- No candidate used a tag outside the allowlist.

**Spend (list price) — both caps were exceeded.** IU $4.53 against a $4.00 cap (the guard checked headroom
before each candidate, not during; `kimi-k3` alone cost $1.85), OpenRouter $0.71 against $0.50 (grok's
reasoning tokens). Nothing is billed beyond list; no production config changed.

**Verdict:** pending. Re-pick triggers unchanged; if a cheaper writer wins the listening, change
`PODCAST_WRITE_MODEL` in audio-gateway `config.ts` and re-run the unit/format tests.

## What the bake-off taught (2026-10-26) — pipeline changes, audio-gateway Wave 2

The ranking waits for ears; the scripts already said a lot about the pipeline. All numbers are from the
seven candidates' drafts and finals (`data/writer-bakeoff/`) and one lab run (`scripts/writer-lab.ts`).

**Cost levers that keep the voice owner**

- **Prompt caching (shipped).** `callAnthropicMessages` now marks the episode-stable system prefix (house rules,
  voice guide, show bible, brief) with `cache_control`. Measured on Opus, two consecutive segment drafts: the second
  read 10,253 of 18,606 input tokens from cache, call cost $0.173 → $0.145 (input cost −52%, whole call −21%). The
  prefix is ~10k tokens per call. On the 2026-10-25 episode shape (24 writer calls, 388k input) that is roughly
  $0.8–0.9 of $3.41 if the cache is warm; the first parallel batch of three segment calls cannot hit it (the cache is
  written when the first response starts), revisions can. Not shipped: moving the per-segment instruction tail out of
  the system prompt so the SOURCE and outline become cacheable too (another ~7k tokens per call) — it changes prompt
  layout and needs its own listening.
- **OpenAI-wire models cache on their own through IU**: `deepseek-v4.1-flash` 58% of input tokens, `kimi-k3` 55%,
  grok (OpenRouter) 9%, `glm-5.3` 0%; `gpt-6-sol` returned no `cached_tokens` at all. IU also returns the billed
  `cost` per call for those routes; it matched the list-price estimate within 1% for glm and kimi, and DeepSeek's
  actual cost was 45% of the peak-rate estimate.
- **The revision pass is the other half of the writer bill**, not an optional polish: for Opus, draft $0.32 vs
  revision $0.39 for the two segments. A revision rewrites 40–70% of a segment's words (kept-word share 27–61% across
  candidates, 100% only where the revision failed), driven by 17–30 notes per segment from six reviewer calls. Part of
  that volume is an artifact of the bake-off (reviewers saw a 2-segment draft and kept noting that three segments were
  missing), so the real episode has fewer. No pass is dropped or made conditional: the data cannot show which notes
  mattered, and cutting notes without listening is a quality bet. The cheap structural fix, if the cost still hurts
  after the caching, is a cap of the ~8 most-converged notes per segment — measure it against ears first.

**Failure patterns in the drafts** (14 final segments, all seven writers)

1. Names used as if known: "Cortex", "engrams", "Sweeper", "Lead", "Version Gating", "ADR hundertneunzehn" were
   spoken before anyone said what they are in 6 of 7 interaction segments. Only haiku defined cron and ADR inline,
   grok and opus explained some terms; nobody explained Cortex. The glossary was empty for this episode, so the writer rule ("the GLOSSARY
   gives you both") had nothing to enforce, and the fact editor judged against a SOURCE that takes the names for
   granted.
2. Echoed reactions: the second host repeats the last words of the previous turn ("Zweitausend Zeilen. Und trotzdem…",
   "Fünfzehn verwaiste Runs.") instead of adding a question, a consequence or a number.
3. The second host almost never asks: 0 questions in 4 of 7 interaction segments, 1 in the rest. Instead of questions
   there are positions — a staged debate, because the brief asked for one.
4. Lecture turns: 80–150 words from the explaining host followed by 10–50 words of reaction; zero turns of eight words
   or fewer in all 14 segments (the 2026-09/10 production episodes have 14%).
5. Identifier verbalisation drifts between writers: "ADR null eins eins neun" / "elf neunzehn" / "einhundertneunzehn".
6. Strongest drafts: `gpt-6-sol` (a real question — "Wie viele Runs betraf es?" — and a defined acronym in the first
   turn), `grok-4.7` (explains "Node und Bun" in one clause), `claude-haiku-5-5` (defines cron and ADR inline, but
   writes 17% short). Nothing here is a ranking: it is what the text shows before listening.

**Why every episode argues:** 7 of the last 10 briefs list a scripted "live disagreement" device and the format names
repeat ("…mit Streitfrage/Gegenrede/Gegenprüfung"). Structural pushes in the prompts: the outline field `tension` was
defined as "the question/disagreement this segment turns on", the hook options named "a live disagreement", the
editor's device list led with it and said "a decision gets two positions that really disagree", and the show bible
listed "Einwand" as the second host's first reaction.

**Changes shipped**

- Outline `tension` is now the segment's pull (open question, curiosity, a reveal); the hook option and the editor's
  device list no longer default to a disagreement; the editor picks a MODE (explainer / story / Q&A / interview /
  debate) from the material, varies it against the recent formats and may choose a debate only for a genuinely
  contested source; the dramaturge flags a manufactured argument; the writer's default is knowledge sharing with the
  density kept ("sharing is not chatter").
- Names: the writer rule now covers every proper name, place, person, company, project, tool, term and abbreviation,
  judged as a stranger to the notes would, and says what to do when neither source nor glossary explains a name. The
  fact editor gets the same stranger test and a per-name first-mention task.
- `src/podcast-lint.ts`: deterministic lint (stock phrases, lecture turns > 130 words, echoed reactions, segments with
  no question, metronomic turn lengths, acronyms/glossary terms used before an introducing clause). Its report goes
  to every reviewer; stock-phrase and unintroduced-term findings become revision notes. Calibrated on the 14 finals:
  it separates haiku (0 findings) from opus/kimi/glm/deepseek interaction (3–5 findings each). Known limit: German
  capitalises every noun, so non-acronym names (Cortex, engrams) are caught by the fact editor, not the lint.
- Show bible: sharing as the normal case, six German before/after pairs from the real drafts.

**Editor test.** The same material through the new editorial prompt, three runs against the real 8 preceding
episodes: Explainer, Explainer, Q&A — no run listed a live disagreement, every run put "no staged opposition" in
`avoid`. The brief that produced the bake-off episode was "Entscheidungsbriefing mit einer offenen Streitfrage".

**Proof, to be heard.** `/tts` → "Podcast writer — improved pipeline": the segment around the DBOS question, old vs new
pipeline, for Opus and `gpt-6-sol`, order shuffled and blind. Lint on the Opus segment: 5 findings (a lecture turn, 2 echoes, no
question, an unintroduced term) before, 0 after, 11 questions from the second host, 23 turns instead of 9, 9% short
turns instead of 0. Caveats: the new segment comes from a new brief and outline (different content, 731 words
against a 590 target — the lab run omitted the tightening pass production runs), and a fact-coverage proxy did not
move (2/8 → 3/11 key facts by token overlap), so density is unproven until it is heard.

## Writer rematch (2026-10-26) — PARTIAL: the $4 IU cap stopped it; verdict pending the owner's ears

**What changed under the rematch.** The pipeline was rebuilt before candidates were compared, so the rematch measures
the final design, not the bake-off's: research with no ceiling (5 gateway runs, 30-term glossary for episode
`8ee3a4df`; the old stage used one), the editor's brief and a fresh frozen outline from the Wave 2 + 3 prompts, per-turn
delivery + a tag band, deterministic expression/segmentation lint, and an **agentic writer** (`podcast-agent.ts`): the
segment draft and every revision run as a tool loop (`lint_segment`, `glossary_lookup`, `brain_search/read`,
`submit_segment`) on the existing `runToolLoop`, so the model measures words-vs-target, rhythm, tags and unintroduced
names before it hands the text in. Reviewer panel, tightening and the expressive synth are the production ones.
Sonnet's Wave 1 failure was a format bug (screenplay text instead of JSON), fixed with `output_config.format`
(structured outputs, GA); `claude-sonnet-5-5` now parses on the first attempt.

**Measured** (episode `8ee3a4df`, opening + the DBOS segment; list prices; cost with caching, projected to the
five-segment outline by target words; reviewers are shared and listed separately):

| Writer | Writer / episode | Reviewers (2 segs) | Wall (draft+review+revise) | Words / target (open, DBOS) | Lint findings left | Notes |
|-|-|-|-|-|-|-|
| `claude-haiku-5-5`, agentic | $0.55 (uncached $0.62) | $0.11 | 325 + 169 + 260 s | 377/430, 554/480 | 1 + 6 | 4–7 rounds per draft, 20 writer calls, 0 failures |
| `gpt-6.1-sol`, single-shot | $0.39 (uncached $0.60) | $0.10 | 51 + 141 + 43 s | 406/430, 552/480 | 1 + 8 | no tool loop (see below); tags 1/2, deliveries 0/3 |
| `claude-opus-5-5`, single-shot (old inputs, reference) | $2.47 | $0.13 | — | 422/400, 592/560 | — | measured before the research/agent rebuild; provisional |

Lint-finding counts include `unintroduced-term` flags in the DBOS segment (5 for Haiku, 7 for Sol): the two-segment
sub-episode never contains the segments where those names are introduced, so most are artefacts, not misses.

**Agentic vs single-shot, same writer, same inputs** (`claude-haiku-5-5`, first inputs): opening 293/400 words and 6
lint findings → 415/400 and 0; DBOS segment 455/560 and 5 findings → 556/560 and 5. Cost $0.036 → $0.122 for the two
segments (3.4×), draft wall 66 → 170 s, revision 98 → 290 s. The loop buys length discipline and clean mechanics for
about three times the money and time; whether it buys better dialogue is the ears' call.

**IU facts learned on the way** (probed 2026-10-26):
- Claude serves function tools on the OpenAI-compatible route with `reasoning_effort: high` and **automatic prompt
  caching** (cache write on the first call, `cached_tokens` on the next) — no native-Anthropic transport needed.
- `gpt-6-luna` accepts tools only with `reasoning_effort: "none"` (the default fails with a 503 naming that fix).
- `gpt-6.1-sol` accepts function tools **only on `/v1/responses`**: every effort value 503s on chat/completions and
  `none` is unsupported. It therefore runs single-shot; a `/responses` transport in the tool loop is the follow-up.
- `gemini-4-argon`: $2 / $10 per M (cached $0.10) through 2026-11-30, then $4 / $20 / $0.20; no context tiers.
  `gpt-6.1-sol` $2 / $10 / $0.10 cached is snippet-level only (provisional).

**Not run — needs a cap raise (~$4.5 on top of the $3.73 spent):** `gpt-6-luna` (started, stopped by the cap
mid-run), `gemini-4-argon`, `gemini-3.8-flash`, `claude-sonnet-5-5` (agentic), `claude-opus-5-5` (agentic baseline,
~$1.5 for two segments), and the hybrid (cheap drafter + Opus revision only). The blind question therefore has two
candidates (Haiku, Sol); the Opus baseline is missing from the listening test.

**Ranked recommendation** (evidence + measured cost; verdict pending the owner's ears; the default stays
`claude-opus-5-5`):
1. `gpt-6.1-sol` — best measured creative-writing evidence of the cheap models (EQ-Bench CW v3 2125, slop 8.97), $0.39
   per episode and four minutes of wall for two segments, length within tolerance. Cost of the agentic loop on it: a
   `/v1/responses` transport.
2. `claude-opus-5-5` agentic — the incumbent and the quality reference; ~$2.5/episode before the loop, more with it.
   Keep until Sol (or the hybrid) wins the blind listen.
3. Hybrid (cheap drafter, Opus revision only) — untested; the revision pass is where Opus's cost concentrates.
4. `claude-haiku-5-5` agentic — cheapest Claude, the loop makes it mechanically clean, but it ran 15% over target on
   the DBOS segment and costs 3.4× its own single-shot; listen before trusting it.
5. Unmeasured: Sonnet 5.5 (format fixed, verbose per community reports), Argon (near Opus on LMArena creative,
   intro price ends 2026-11-30), `gemini-3.8-flash` (CW 1745, slop 22.6 — expected to sound sloppy), `gpt-6-luna`.

**Proof, to be heard.** `/tts` → "Podcast writer — rematch" (blind, letters only) and "Expressiveness" (flat vs tags vs
tags + delivery for podcast, briefing and chat).
