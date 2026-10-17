# bench-writing report

Generated 2026-10-17T08:28:07.197Z. Candidates: claude-opus-5-5, gemini-4-argon, claude-opus-4-6, claude-fable-5-1, gpt-6-astra. Judges: claude-sonnet-5, gemini-3.8-flash, gpt-6-luna.
Tasks: de-tech, en-article, landing, ui-copy, rewrite, de-briefing. Effort: high. Token budget per call: 16000.
System prompt: /Users/jkrumm/SourceRoot/brain/voice.md plus the task instruction.

## Leaderboard

| # | model | overall (mean of tasks) | tasks scored | min judges | starved |
|-|-|-|-|-|-|
| 1 | gpt-6-astra | 4.16 | 6/6 | 2 | 0/6 |
| 2 | claude-opus-5-5 | 4.10 | 6/6 | 2 | 0/6 |
| 3 | claude-fable-5-1 | 4.02 | 6/6 | 2 | 0/6 |
| 4 | claude-opus-4-6 | 3.96 | 6/6 | 2 | 0/6 |
| 5 | gemini-4-argon | 3.93 | 6/6 | 2 | 0/6 |

## Per task

### de-tech — German technical explanation for an Obsidian vault page

| model | overall | judges | status | words | banned | neg-par | -ung/-heit/-keit per 100w | >30w sentences | repeat pairs |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 4.06 | 2 | ok | 295 | 0 | 0 | 0 | 0 | 0 |
| gemini-4-argon | 4.00 | 2 | ok | 260 | 0 | 0 | 0 | 0 | 0 |
| claude-opus-4-6 | 4.44 | 2 | ok | 225 | 0 | 0 | 0.4 | 0 | 0 |
| claude-fable-5-1 | 4.17 | 2 | ok | 246 | 0 | 0 | 0.4 | 0 | 0 |
| gpt-6-astra | 4.11 | 2 | ok | 237 | 0 | 0 | 0 | 0 | 0 |

Per-criterion median across eligible judges:

| model | verdict_first | structure | no_repetition | concision | precision | clarity | visual_fit | naturalness | engagement |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 5 | 4.5 | 3 | 3.5 | 4.5 | 4 | 5 | 4 | 3 |
| gemini-4-argon | 4.5 | 5 | 3.5 | 4 | 4.5 | 3.5 | 4.5 | 3.5 | 3 |
| claude-opus-4-6 | 4.5 | 5 | 4.5 | 4.5 | 4 | 4.5 | 5 | 4 | 4 |
| claude-fable-5-1 | 4.5 | 4.5 | 3 | 3.5 | 5 | 4.5 | 4.5 | 4 | 4 |
| gpt-6-astra | 4.5 | 4 | 4.5 | 4 | 5 | 4 | 3.5 | 4 | 3.5 |

### en-article — English peer-technical article section from bullet notes

| model | overall | judges | status | words | banned | neg-par | -ung/-heit/-keit per 100w | >30w sentences | repeat pairs |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 4.11 | 2 | ok | 412 | 0 | 0 | — | 0 | 0 |
| gemini-4-argon | 3.39 | 2 | ok | 320 | 0 | 0 | — | 4 | 0 |
| claude-opus-4-6 | 4.11 | 2 | ok | 371 | 0 | 0 | — | 1 | 0 |
| claude-fable-5-1 | 3.72 | 2 | ok | 381 | 0 | 1 | — | 1 | 1 |
| gpt-6-astra | 4.06 | 2 | ok | 254 | 0 | 0 | — | 0 | 0 |

Per-criterion median across eligible judges:

| model | verdict_first | structure | no_repetition | concision | precision | clarity | visual_fit | naturalness | engagement |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 5 | 4.5 | 3 | 4 | 4 | 4.5 | 4.5 | 4 | 3.5 |
| gemini-4-argon | 4.5 | 2.5 | 3 | 3.5 | 4.5 | 3 | 2.5 | 4 | 3 |
| claude-opus-4-6 | 5 | 4 | 3.5 | 3.5 | 4 | 4.5 | 4 | 4.5 | 4 |
| claude-fable-5-1 | 3 | 4 | 3 | 3.5 | 4 | 4 | 4 | 4 | 4 |
| gpt-6-astra | 4 | 4.5 | 3.5 | 4 | 5 | 4.5 | 4.5 | 3.5 | 3 |

### landing — Broad-register landing page hero plus three benefits

| model | overall | judges | status | words | banned | neg-par | -ung/-heit/-keit per 100w | >30w sentences | repeat pairs |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 3.89 | 2 | ok | 130 | 0 | 0 | — | 0 | 0 |
| gemini-4-argon | 3.28 | 2 | ok | 209 | 0 | 0 | — | 1 | 0 |
| claude-opus-4-6 | 3.89 | 2 | ok | 140 | 0 | 0 | — | 0 | 0 |
| claude-fable-5-1 | 3.83 | 2 | ok | 184 | 0 | 0 | — | 0 | 0 |
| gpt-6-astra | 3.50 | 2 | ok | 118 | 0 | 0 | — | 0 | 0 |

Per-criterion median across eligible judges:

| model | verdict_first | structure | no_repetition | concision | precision | clarity | visual_fit | naturalness | engagement |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 4.5 | 4 | 4 | 4.5 | 2 | 4 | 4 | 4 | 4 |
| gemini-4-argon | 4 | 4 | 3.5 | 2.5 | 3.5 | 3 | 3.5 | 2.5 | 3 |
| claude-opus-4-6 | 4.5 | 4 | 3 | 4 | 3 | 4.5 | 4 | 4 | 4 |
| claude-fable-5-1 | 4.5 | 4.5 | 2.5 | 3 | 4 | 4 | 4 | 4 | 4 |
| gpt-6-astra | 3 | 4 | 4.5 | 4 | 2.5 | 4.5 | 2.5 | 3.5 | 3 |

### ui-copy — UI microcopy for one screen, as a labeled list

| model | overall | judges | status | words | banned | neg-par | -ung/-heit/-keit per 100w | >30w sentences | repeat pairs |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 4.50 | 2 | ok | 56 | 0 | 0 | — | 0 | 0 |
| gemini-4-argon | 4.28 | 2 | ok | 57 | 0 | 0 | — | 0 | 0 |
| claude-opus-4-6 | 4.06 | 2 | ok | 52 | 0 | 0 | — | 0 | 0 |
| claude-fable-5-1 | 4.11 | 2 | ok | 61 | 0 | 0 | — | 0 | 0 |
| gpt-6-astra | 4.33 | 2 | ok | 48 | 0 | 0 | — | 0 | 1 |

Per-criterion median across eligible judges:

| model | verdict_first | structure | no_repetition | concision | precision | clarity | visual_fit | naturalness | engagement |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 4.5 | 5 | 5 | 4.5 | 3.5 | 5 | 5 | 4.5 | 3.5 |
| gemini-4-argon | 4 | 5 | 5 | 5 | 4 | 4.5 | 4 | 4 | 3 |
| claude-opus-4-6 | 4.5 | 4.5 | 5 | 4 | 3 | 4 | 4.5 | 3.5 | 3.5 |
| claude-fable-5-1 | 4.5 | 5 | 5 | 3.5 | 2.5 | 4 | 5 | 4 | 3.5 |
| gpt-6-astra | 4.5 | 5 | 5 | 5 | 3.5 | 5 | 4 | 4 | 3 |

### rewrite — Rewrite a convoluted AI-style paragraph into clear structured prose

| model | overall | judges | status | words | banned | neg-par | -ung/-heit/-keit per 100w | >30w sentences | repeat pairs |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 3.94 | 2 | ok | 129 | 0 | 0 | — | 0 | 1 |
| gemini-4-argon | 4.22 | 2 | ok | 98 | 0 | 0 | — | 0 | 0 |
| claude-opus-4-6 | 3.44 | 2 | ok | 127 | 0 | 0 | — | 0 | 0 |
| claude-fable-5-1 | 4.44 | 2 | ok | 110 | 0 | 0 | — | 0 | 0 |
| gpt-6-astra | 4.61 | 2 | ok | 101 | 0 | 0 | — | 0 | 0 |

Per-criterion median across eligible judges:

| model | verdict_first | structure | no_repetition | concision | precision | clarity | visual_fit | naturalness | engagement |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 4.5 | 4.5 | 3 | 3 | 4.5 | 4.5 | 5 | 3.5 | 3 |
| gemini-4-argon | 5 | 4 | 4.5 | 5 | 4.5 | 4 | 3.5 | 4 | 3.5 |
| claude-opus-4-6 | 4 | 3 | 2.5 | 3.5 | 4 | 3.5 | 3 | 4 | 3.5 |
| claude-fable-5-1 | 5 | 4 | 4.5 | 4.5 | 5 | 5 | 4 | 4 | 4 |
| gpt-6-astra | 4.5 | 5 | 4.5 | 4.5 | 5 | 5 | 5 | 4.5 | 3.5 |

### de-briefing — German personal briefing (bullets) from raw daily data

| model | overall | judges | status | words | banned | neg-par | -ung/-heit/-keit per 100w | >30w sentences | repeat pairs |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 4.11 | 2 | ok | 185 | 0 | 0 | 1.6 | 0 | 0 |
| gemini-4-argon | 4.39 | 2 | ok | 145 | 0 | 0 | 0 | 0 | 0 |
| claude-opus-4-6 | 3.83 | 2 | ok | 158 | 0 | 0 | 0 | 0 | 1 |
| claude-fable-5-1 | 3.83 | 2 | ok | 200 | 0 | 0 | 0.5 | 0 | 0 |
| gpt-6-astra | 4.33 | 2 | ok | 181 | 0 | 0 | 0.6 | 0 | 0 |

Per-criterion median across eligible judges:

| model | verdict_first | structure | no_repetition | concision | precision | clarity | visual_fit | naturalness | engagement |
|-|-|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 4.5 | 4.5 | 4.5 | 4 | 4 | 4.5 | 4.5 | 3.5 | 3 |
| gemini-4-argon | 4.5 | 4.5 | 5 | 4.5 | 4.5 | 4 | 4.5 | 4.5 | 3.5 |
| claude-opus-4-6 | 4.5 | 4.5 | 4 | 4 | 2 | 4 | 4.5 | 3.5 | 3.5 |
| claude-fable-5-1 | 4.5 | 4.5 | 4 | 3 | 2.5 | 4 | 4.5 | 4 | 3.5 |
| gpt-6-astra | 4.5 | 5 | 5 | 4 | 4.5 | 5 | 4 | 4 | 3 |

## Cost and latency

| model | calls | starved | errors | truncated | median wall | median out tokens | cost |
|-|-|-|-|-|-|-|-|
| claude-opus-5-5 | 6 | 0 | 0 | 0 | 17.6s | 1628 | $0.3378 |
| gemini-4-argon | 6 | 0 | 0 | 0 | 62.1s | 2424 | $0.2206 |
| claude-opus-4-6 | 6 | 0 | 0 | 0 | 10.6s | 625 | $0.2401 |
| claude-fable-5-1 | 6 | 0 | 0 | 0 | 18.7s | 1453 | $0.7847 |
| gpt-6-astra | 6 | 0 | 0 | 0 | 22.5s | 978 | $0.5095 |

Judges:

| judge | calls | parsed | retried | cost |
|-|-|-|-|-|
| claude-sonnet-5 | 6 | 6 | 0 | $0.1155 |
| gemini-3.8-flash | 6 | 6 | 1 | $0.0738 |
| gpt-6-luna | 6 | 6 | 0 | $0.0086 |

Total spend: $2.2904 (cost from usage tokens x the metric_snapshot rate card; a model with no rate reads —).

## Failures

None.

## How to read this

**Judging is cross-lab only.** A judge never scores its own lab's output, so a cell is judged by the
judges that remain (`judges` column) and different candidates are judged by different panels. Read a
cell with one judge as one opinion. Scores are medians across judges, overall is the mean of the
nine criterion medians.

**LLM judges are not the reader.** Judges favoured the Opus-5 style in earlier writing benchmarks while
the owner did not (see EQ-Bench in AGENTS.md). Treat the score as a shortlist; the blind read in
`blind.md` decides.

**Lint is a smoke detector.** The mechanical columns count surface patterns from the voice guide
(banned lexical items in English output, negative parallelisms, German -ung/-heit/-keit density,
sentences over 30 words, near-duplicate sentence pairs). A hit means look here, not bad prose. English
tech terms inside German text are never flagged.

**`starved`** is a call that hit its token cap with nothing visible. It is a budget failure, counted
separately and never scored as a bad answer. **`truncated`** is a call that hit the cap with partial
text; it is judged as written.
