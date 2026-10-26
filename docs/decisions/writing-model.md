# Writing Model — Opus 4.6 holds, and the LLM judge is the one that's wrong

> **Current verdict (2026-10-17):** `claude-opus-5-5` replaces `claude-opus-4-6` as the writing
> pick — LMArena `creative_writing` #1 (4.6 dropped to #4), level or better with the cross-lab judges
> on `bench:writing`, and cheaper. Owner decision without the blind read; German stays
> under-evidenced. Consumers: agent-gateway's `prose` tool (`prose_write`) and, since 2026-10-19, the
> podcast writer (audio-gateway `PODCAST_WRITE_MODEL`) — see the podcast A/B below.
> **Status of this record:** current
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

## 2026-10-17 — re-check: Arena moved, the judges call it a tie

- **LMArena `creative_writing` (2026-10-15):** `claude-opus-5-5` #1, `gemini-4-argon` #2,
  `claude-opus-4-6` #4. The #2 that backed this pick is stale. Best Grok is #25. Grok isn't
  routed on IU (`not_routed` since 2026-09-24) and xAI has no EU residency, so it is out.
- **`bun run bench:writing`** (six communication tasks, voice.md v2 as system prompt, cross-lab
  judges, n=1 per task — [report](../experiments/writing/2026-10-17/report.md)):

| model | overall | median wall | cost / 6 tasks |
|-|-|-|-|
| gpt-6-astra | 4.16 | 22.5s | $0.51 |
| claude-opus-5-5 | 4.10 | 17.6s | $0.34 |
| claude-fable-5-1 | 4.02 | 18.7s | $0.78 |
| claude-opus-4-6 | 3.96 | 10.6s | $0.24 |
| gemini-4-argon | 3.93 | 62.1s | $0.22 |

A 0.23 spread on one sample per task is no signal, and LLM judges are the instrument this record
already distrusts. The pick holds until the owner's blind read of
[`blind.md`](../experiments/writing/2026-10-17/blind.md) (labels in `key.json`). If that read
prefers `claude-opus-5-5`, switch: it is cheaper ($4/$20 vs $5/$25 per M) and leads Arena.

**Switched the same day (owner decision).** The judges cannot separate the two, Arena can, and 5.5
costs less — so the blind read became a confirmation step, not a gate. First live job on agent-gateway's
`prose` tool: a convoluted German vault paragraph came back as a verdict sentence plus a table in 19 s,
lint findings 3 → 0, the URL and the code block intact. One flaw worth watching: it turned "observed
twice" into "tried twice" — a small fact shift the keep gate cannot see.

**Current:** `claude-opus-4-6`, for English and German long-form prose written against
`brain/voice.md`. This record exists because the two writing leaderboards pulled in on
2026-09-11 disagree about it by roughly eighteen ranks, and because the one that ranks it
low is the one that shouldn't be trusted here.

## 2026-10-19 — the podcast writer follows, on the native wire

audio-gateway called Opus through the IU chat-completions shim, which gives Claude no thinking
control. The writer now uses the native Anthropic Messages route with adaptive thinking and
`output_config.effort: "high"`, and `brain/voice.md` precedes the show bible. One same-input A/B
(a stored 12-minute German episode, its own brief and dossier, script only, no TTS):

| | claude-opus-4-6 | claude-opus-5-5 |
|-|-|-|
| Wall time | 936 s | 482 s |
| Output tokens (all writer calls) | 199k | 64k |
| Turns / words | 68 / 2,620 | 54 / 2,605 |
| Failures | segment 1 invalid JSON twice (German `„…"` closed with an ASCII quote) | none |
| Factual slips | none seen | one: port 7719 spelled out as "siebentausendeinhundertneunzehn" |

Read side by side, 5.5 has shorter sentences, real back-and-forth between the hosts, and uses a
sourced anecdote (the port collision) that 4.6 skipped; 4.6 runs to longer monologues. Half the
time, a third of the output tokens (4.6's count includes its aborted first run). One sample, read
side by side, not blind-judged — not a benchmark. The JSON failure was fixed in code (a quote
repair used only when the original fails to parse), so it no longer decides between models. The
spelled-out number slip is the thing to watch in the next real episodes. Rollback: `PODCAST_WRITE_MODEL=claude-opus-4-6`.

## The disagreement

| Model | EQ-Bench CW v3 Elo | Rubric (0–20) | Slop ↓ | LMArena `creative_writing` |
|-|-|-|-|-|
| gpt-6-astra | 2163.9 | 16.80 | 8.41 | — |
| claude-fable-5-1 | 2152.7 | 16.95 | 8.16 | **1508.1 (#1)** |
| claude-opus-5 | 2120.6 | **17.07** | **6.59** | 1489.8 (#6) |
| kimi-k3 | 2070.6 | 16.85 | 9.70 | — |
| gpt-5.6-sol | 1963.4 | 16.78 | 11.68 | — |
| **claude-opus-4-6** | 1804.1 (≈#20) | 16.53 | 12.12 | **1504.7 (#2)**, n=12,678 |
| gemini-3.1-pro | 1488.9 | 16.04 | 30.03 | 1480.5 (#11) |

EQ-Bench snapshot: site repo at `HEAD`. Arena snapshot: `leaderboard_publish_date`
2026-09-02.

## Why Arena wins this one

**The EQ-Bench judge is Claude.** Elo judging moved to Claude Sonnet 4.6 in March 2026;
rubric scoring runs on Sonnet 4. EQ-Bench documents judge self- and family-bias as a known
limitation of its own design. A Claude-family judge putting the newest Claude on top is the
weakest possible evidence for that claim.

**Slop score measures deviation, not readability.** It counts matches against a list of
overused LLM phrases. A model can drive that number down by writing *strangely* — unusual
word choices, contorted syntax — and score as un-sloppy while being harder to read. Opus 5's
6.59 is the lowest in the field and coincides with independent user reports (mine and
others') that its prose is confusing enough to need a global CLAUDE.md mitigation. Low slop
is a property worth displaying and a terrible thing to rank on.

**The construct doesn't transfer.** EQ-Bench CW v3 is 32 fiction prompts × 3 iterations,
English only. The actual use case is German and English non-fiction written to a style
guide. Arena's `creative_writing` category is human pairwise preference on prompts users
actually sent — a different and, for this purpose, better-aimed instrument, with 12,678
votes behind the Opus 4.6 row versus a single graded run behind the EQ-Bench one.

EQ-Bench's longform table agrees with its short-form one, not with Arena: `claude-opus-5`
86.3 with the field's lowest slop again (5.64), `claude-fable-5-1` 85.3, `claude-opus-4-6`
77.7 over eight ~1,000-word chapters. That is not a second independent vote — both
leaderboards are the same instrument run at two lengths, with the same judge family and
the same slop list. Two agreeing measurements from one instrument do not outweigh a
different instrument that disagrees.

## German: there is no benchmark, and the gap is real

No public benchmark scores German *prose quality*. What exists measures something else:

| Source | What it actually measures |
|-|-|
| EuroEval German | MLSUM news summarization (ChrF3++ against references), NLU, instruction compliance |
| DACH-bench | German competence — NER, sentiment, acceptability, translated knowledge |
| MELA | Sentence-level syntactic acceptability, scored by MCC |
| Telekom Ger-RAG-eval | Retrieval and answer-match classification |
| EQ-Bench | English only; German exists solely in the legacy EQ v2 emotional-intelligence track |

That leaves LMArena's `german` category as the only German signal, and it is an aggregate
over every task type — maths and code included, not a prose slice:

| Rank | Model | Elo | n |
|-|-|-|-|
| 1 | claude-opus-5-max | 1517.4 | 295 |
| 2 | gemini-3-pro | 1516.6 | 797 |
| 3 | claude-opus-5-high | 1506.8 | 552 |
| 4 | claude-opus-4-6-high | 1505.1 | 1206 |

The confidence intervals on ranks 1–4 overlap completely. **The honest reading is
"indistinguishable", not a ranking** — and given the slop-versus-strangeness finding above,
an opus-5 row at the top of an aggregate German table is not a reason to switch a German
prose pick.

## How this is wired

`writing` is a scored category. Its quality dimension is normalized `arena_creative_writing` only
(Wave 3, 2026-10-26: the EQ-Bench collector and its diagnostics were removed — a Claude judge
grading Claude, and slop rewards prose that merely reads as different). A model with no Arena row
stays unscored on writing; it never falls back to general quality.

Collector: `src/server/collectors/lmarena.ts` (LMArena's official leaderboard export via the Hugging
Face datasets-server, CC BY 4.0, human pairwise votes).

## What would change this

A German prose evaluation with native-German prompts and native-German human judgement.
Nothing public does this today. Until something does, the German pick is not a leaderboard
output — it is a judgement call with `arena_german` as a sanity check that the model is at
least competent in the language.

## 2026-09-12: the recommender prefers `gemini-3.8-flash`, and neither side has German prose evidence

The `writing` recommendation moved to `gemini-3.8-flash`, flagging `audio/podcast-write` as
drift. The first pass at this section argued the drift away using `arena_german`. **That
argument was wrong and is retracted**: a research pass on the German evaluation landscape
(2026-09-12) established that LMArena's German slice is *crowdsourced pairwise preference over
German chat* — helpfulness, correctness, instruction following and task success all at once,
scored by an open self-selected voter pool with no documented German-proficiency screen. It is
not a controlled measure of German prose quality, and the dedicated `/leaderboard/german` path
now returns "Leaderboard Not Found". Using it as a German writing score was the same class of
error this record calls out in EQ-Bench: treating a number as if it measured the construct its
name suggests.

What the evidence actually is:

| model | arena_german (chat pref) | arena_creative_writing (EN) | EQ-Bench | direct German writing eval |
|-|-|-|-|-|
| `glm-5.3` | 1531.1 | 1467.2 | 2064.1 | none |
| `claude-opus-5` | 1526.0 | 1489.5 | 2120.6 | none |
| `claude-opus-4-6` | 1505.9 | 1504.5 | 1804.1 | **none found** |
| `claude-fable-5-1` | — | **1508.8** | 2152.7 | none |
| `gemini-3.8-flash` | — | 1497.1 | 1749.7 | NC-Bench: 100/100 German character dialogue (5 scenarios), 83.1% overall creative writing — *medium confidence, thin methodology* |

**No mature German prose-quality benchmark exists.** The closest public work is CityLAB
Berlin's 2025 manual comparison (three tasks, three runs, one judging setup, none of the models
we use), a multilingual `story_writing_benchmark` HF dataset that includes German but documents
no annotation protocol, and Drackert et al. 2025, which evaluates German reading passages for
exam suitability rather than literary merit. DACH-bench, GermanWeb and SuperGLEBer measure
comprehension and reasoning, not generated prose. EQ-Bench Creative Writing and LitBench are not
German-specific.

Anthropic publishes no German writing evaluation for Opus 4.6; Google publishes none for Gemini
3.8 Flash. The single located German creative-writing datapoint therefore **favours the
challenger**, not the incumbent — and it is one third-party page with limited methodology.

One source we do not collect and should: ArtificialAnalysis publishes a German-language
*reasoning* index (`artificialanalysis.ai/models/multilingual/german`, Opus 4.6 at 93). Still
not prose, but it is a German-specific number with a documented method, which is more than
`arena_german` offers.

**Verdict: the pick does not move, but it is now explicitly under-evidenced, not defended.**
`claude-opus-4-6` stays because it is the only candidate near the top of English creative
writing *and* with a real German chat row, and because no German prose measurement exists that
would justify a switch. The drift flag stays live rather than being explained away.

**The way to actually settle this is a blind German listening/reading test**, the same method
that settled TTS and dense-diagram reading in this stack — two podcast scripts from the same
brief, `claude-opus-4-6` vs `gemini-3.8-flash` vs `claude-fable-5-1`, judged blind by the only
German-proficient evaluator that matters here. That is a half-hour of work and it beats every
number in the table above.
