# Writing Model — Opus 4.6 holds, and the LLM judge is the one that's wrong

> **Current verdict (2026-09-12):** `claude-opus-4-6` holds for English/German long-form prose,
> but is explicitly under-evidenced for German — no public benchmark scores German prose
> quality.
> **Status of this record:** current
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

**Current:** `claude-opus-4-6`, for English and German long-form prose written against
`brain/voice.md`. This record exists because the two writing leaderboards pulled in on
2026-09-11 disagree about it by roughly eighteen ranks, and because the one that ranks it
low is the one that shouldn't be trusted here.

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

`writing` is a scored category. Its quality dimension is a preference chain, not a blend:
normalized `arena_creative_writing` when the model has an Arena row, falling back to
normalized `creative_writing_elo` only for models Arena has never seen. Same shape as the
latency derivation in `scoring/normalize.ts`, for the same reason — the better-aimed
measurement wins, the other one fills gaps.

`slop_score`, `repetition_score`, `vocab_complexity`, `longform_writing` and
`longform_slop_score` are collected and shown on `/benchmarks`. **None of them enters a
score.** They are diagnostics; slop in particular is the metric this record exists to
refuse to rank on.

Collectors: `src/server/collectors/eqbench.ts` (EQ-Bench site repo, LLM-judged, English),
`src/server/collectors/lmarena.ts` (LMArena's official leaderboard export via the Hugging
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
