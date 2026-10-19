# bench-fast report

Generated 2026-10-19T09:10:53.736Z. Models: deepseek-v4.1-flash, claude-haiku-5-5-eu, gpt-5.6-luna. Tasks: extract, reason, classify, instruct, longform. Repeats: 3.

## Crossover: does the faster decoder actually win?

For each candidate against `gpt-5.6-luna`, the output length (in visible
tokens) beyond which a later-starting, faster-decoding model overtakes the
earlier-starting one — derived from each model's `default`-effort median
TTFT and decode rate. `crossover_tokens = (ttft_B - ttft_A) / (1/rate_A -
1/rate_B)`, where A is the later-starting/faster-decoding model.

- **deepseek-v4.1-flash** needs an output longer than **472 tokens** to finish before **gpt-5.6-luna**; the longform task produced 1613 visible tokens — the longform task clears this.
- **claude-haiku-5-5-eu** needs an output longer than **389 tokens** to finish before **gpt-5.6-luna**; the longform task produced 3072 visible tokens — the longform task clears this.

## Headline

| model | effort | pass | starved | timed | median wall | median ttft | median think | decode tok/s | completion tok | think spread | think:visible | $/run | verdict |
|-|-|-|-|-|-|-|-|-|-|-|-|-|-|
| gpt-5.6-luna | none | 4/5 | 0/15 | 15/15 | 865ms | 446ms | 2ms | 143.8 tok/s | 62 | 28 | 0.02 | $0.003150 | honoured |
| gpt-5.6-luna | medium | 4/5 | 0/15 | 15/15 | 1062ms | 652ms | 1ms | 140.7 tok/s | 105 | 154 | 0.42 | $0.003299 | honoured |
| gpt-5.6-luna | low | 5/5 | 0/15 | 15/15 | 1108ms | 771ms | 0ms | 137.1 tok/s | 96 | 170 | 0.39 | $0.002973 | honoured |
| gpt-5.6-luna | high | 5/5 | 0/15 | 15/15 | 1138ms | 810ms | 6ms | 147.6 tok/s | 124 | 866 | 0.67 | $0.003933 | honoured |
| claude-haiku-5-5-eu | low | 4/5 | 0/15 | 15/15 | 1274ms | 1019ms | 139ms | 185.5 tok/s | 109 | 965 | 0.46 | no rate | honoured |
| deepseek-v4.1-flash | none | 5/5 | 0/15 | 15/15 | 1351ms | 1269ms | 891ms | 170.9 tok/s | 122 | 1648 | 0.93 | $0.000458 | honoured |
| gpt-5.6-luna | default | 5/5 | 0/15 | 15/15 | 1365ms | 898ms | 0ms | 138.7 tok/s | 98 | 265 | 0.39 | $0.003295 | honoured |
| deepseek-v4.1-flash | high | 5/5 | 0/15 | 15/15 | 1420ms | 1269ms | 761ms | 341.1 tok/s | 142 | 7486 | 1.33 | $0.001133 | honoured |
| deepseek-v4.1-flash | medium | 5/5 | 0/15 | 15/15 | 1573ms | 1411ms | 1023ms | 177.4 tok/s | 143 | 2241 | 1.13 | $0.000507 | honoured |
| deepseek-v4.1-flash | default | 5/5 | 0/15 | 15/15 | 1585ms | 1496ms | 720ms | 168.3 tok/s | 138 | 2622 | 1.08 | $0.000531 | honoured |
| deepseek-v4.1-flash | low | 5/5 | 0/15 | 15/15 | 1609ms | 1373ms | 844ms | 183.6 tok/s | 127 | 2262 | 0.95 | $0.000416 | honoured |
| claude-haiku-5-5-eu | high | 4/5 | 0/15 | 15/15 | 1657ms | 1341ms | 508ms | 225.0 tok/s | 279 | 4728 | 0.95 | no rate | honoured |
| claude-haiku-5-5-eu | none | 4/5 | 0/15 | 15/15 | 1672ms | 1150ms | 130ms | 151.0 tok/s | 108 | 494 | 0.50 | no rate | honoured |
| claude-haiku-5-5-eu | medium | 5/5 | 0/15 | 15/15 | 1782ms | 1375ms | 507ms | 212.7 tok/s | 241 | 3298 | 0.77 | no rate | honoured |
| claude-haiku-5-5-eu | default | 5/5 | 0/15 | 15/15 | 2124ms | 1845ms | 502ms | 209.5 tok/s | 266 | 3139 | 1.03 | no rate | honoured |

## Per-model effort curve

### deepseek-v4.1-flash

| effort | pass rate | starved | median wall | completion tok | thinking spread |
|-|-|-|-|-|-|
| default | 15/15 (100%) | 0/15 | 1585ms | 138 | 2622 |
| none | 15/15 (100%) | 0/15 | 1351ms | 122 | 1648 |
| low | 15/15 (100%) | 0/15 | 1609ms | 127 | 2262 |
| medium | 15/15 (100%) | 0/15 | 1573ms | 143 | 2241 |
| high | 15/15 (100%) | 0/15 | 1420ms | 142 | 7486 |

### claude-haiku-5-5-eu

| effort | pass rate | starved | median wall | completion tok | thinking spread |
|-|-|-|-|-|-|
| default | 14/15 (93%) | 0/15 | 2124ms | 266 | 3139 |
| none | 13/15 (87%) | 0/15 | 1672ms | 108 | 494 |
| low | 11/15 (73%) | 0/15 | 1274ms | 109 | 965 |
| medium | 15/15 (100%) | 0/15 | 1782ms | 241 | 3298 |
| high | 13/15 (87%) | 0/15 | 1657ms | 279 | 4728 |

### gpt-5.6-luna

| effort | pass rate | starved | median wall | completion tok | thinking spread |
|-|-|-|-|-|-|
| default | 14/15 (93%) | 0/15 | 1365ms | 98 | 265 |
| none | 13/15 (87%) | 0/15 | 865ms | 62 | 28 |
| low | 14/15 (93%) | 0/15 | 1108ms | 96 | 170 |
| medium | 12/15 (80%) | 0/15 | 1062ms | 105 | 154 |
| high | 14/15 (93%) | 0/15 | 1138ms | 124 | 866 |

## What this does and does not measure

This measures **operational fitness and cost-of-correctness** on five narrow,
deterministic tasks (structured extraction, arithmetic word-problem reasoning,
single-label classification, multi-constraint instruction-following, and a
~1200-word longform explanation) across a model's `reasoning_effort` ladder.
A passing cell means the task floor was cleared at that effort level, in this
many repeats — it is not a general intelligence benchmark, and it says
nothing about capability on harder tasks. The headline number is median
**wall time to a correct answer**, not time-to-first-token: a model that
starts late and decodes fast can still win, and this is the harness built to
see that.

**`starved`** means the call hit its token cap (`finish_reason: "length"`)
having produced zero visible tokens — it spent the whole budget on hidden
reasoning and never got to answer. That is a budget failure, not a wrong
answer: starved calls are counted separately (the `starved` column) and
excluded from the pass rate, and a cell where they are the majority reports
`starved` in place of a pass fraction rather than a misleadingly low score.

**`unreliable`** in the think:visible / thinking-spread columns means the
model's reported `reasoning_tokens` value looked like a fixed constant across
a spread of tasks with very different token budgets — a route-level reporting
artifact, not a real measurement — so it is named rather than shown as a
number that would misrepresent the model.

**Pass rate at `--repeat 3` is a sample, not a fixed capability.** A model
whose thinking expands or contracts run to run at the same effort level and
cap (visible in a wide `thinking spread`) can flip between pass and fail on
an identical prompt purely from that variance — read a middling pass rate as
noise at this repeat count, not as a stable score.
