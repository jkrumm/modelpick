# bench-fast report

Generated 2026-09-12T13:10:50.956Z. Models: gpt-5.6-luna, deepseek-v4.1-flash, gemini-3.8-flash, glm-5.3-flash, minimax-m3. Tasks: extract, reason, classify, instruct, longform. Repeats: 3.

## Crossover: does the faster decoder actually win?

For each candidate against `gpt-5.6-luna`, the output length (in visible
tokens) beyond which a later-starting, faster-decoding model overtakes the
earlier-starting one — derived from each model's `default`-effort median
TTFT and decode rate. `crossover_tokens = (ttft_B - ttft_A) / (1/rate_A -
1/rate_B)`, where A is the later-starting/faster-decoding model.

- **deepseek-v4.1-flash** needs an output longer than **84 tokens** to finish before **gpt-5.6-luna**; the longform task produced 431 visible tokens — the longform task clears this.
- **gemini-3.8-flash**: n/a — **gpt-5.6-luna** starts no later and decodes no slower, so it finishes first at every output length.
- **glm-5.3-flash**: n/a — no `default`-effort data for this model or the baseline.
- **minimax-m3** needs an output longer than **934 tokens** to finish before **gpt-5.6-luna**; the longform task produced 1947 visible tokens — the longform task clears this.

## Headline

| model | effort | pass | starved | timed | median wall | median ttft | median think | decode tok/s | completion tok | think spread | think:visible | $/run | verdict |
|-|-|-|-|-|-|-|-|-|-|-|-|-|-|
| gpt-5.6-luna | none | 4/5 | 0/15 | 15/15 | 600ms | 356ms | 1ms | 159.1 tok/s | 59 | 28 | 0.04 | $0.003006 | honoured |
| deepseek-v4.1-flash | none | 4/5 | 2/15 | 13/15 | 668ms | 596ms | 215ms | 657.6 tok/s | 176 | 7975 | 2.13 | $0.005337 | accepted-but-ignored |
| deepseek-v4.1-flash | medium | 4/5 | 2/15 | 13/15 | 737ms | 649ms | 205ms | 511.0 tok/s | 162 | 7970 | 2.02 | $0.005358 | accepted-but-ignored |
| deepseek-v4.1-flash | low | 4/5 | 2/15 | 13/15 | 762ms | 629ms | 205ms | 686.0 tok/s | 146 | 7968 | 2.13 | $0.005309 | accepted-but-ignored |
| deepseek-v4.1-flash | high | 4/5 | 1/15 | 14/15 | 963ms | 884ms | 251ms | 535.4 tok/s | 153 | 7970 | 2.32 | $0.005341 | accepted-but-ignored |
| gpt-5.6-luna | low | 4/5 | 0/15 | 15/15 | 986ms | 633ms | 0ms | 159.2 tok/s | 107 | 161 | 0.42 | $0.003258 | honoured |
| gpt-5.6-luna | default | 5/5 | 0/15 | 15/15 | 1023ms | 626ms | 0ms | 156.0 tok/s | 105 | 335 | 0.52 | $0.003376 | honoured |
| gpt-5.6-luna | high | 4/5 | 0/15 | 15/15 | 1067ms | 677ms | 4ms | 152.2 tok/s | 115 | 955 | 0.69 | $0.004186 | honoured |
| gpt-5.6-luna | medium | 5/5 | 0/15 | 15/15 | 1095ms | 729ms | 2ms | 161.4 tok/s | 106 | 202 | 0.54 | $0.003256 | honoured |
| deepseek-v4.1-flash | default | 4/5 | 1/15 | 14/15 | 1124ms | 1024ms | 186ms | 604.4 tok/s | 142 | 7974 | 2.37 | $0.005273 | accepted-but-ignored |
| gemini-3.8-flash | none | 4/5 | 0/15 | 15/15 | 1758ms | 1498ms | 0ms | 234.1 tok/s | 315 | 1650 | 1.85 | $0.019827 | honoured |
| glm-5.3-flash | low | 5/5 | 0/15 | 15/15 | 1802ms | 1798ms | 0ms | 79.8 tok/s | 69 | 48 | 0.29 | $0.001245 | honoured |
| glm-5.3-flash | none | 5/5 | 0/15 | 15/15 | 1820ms | 1810ms | 0ms | 76.1 tok/s | 66 | 33 | 0.23 | $0.001187 | honoured |
| minimax-m3 | low | 5/5 | 2/15 | 13/15 | 1896ms | 1881ms | 818ms | 72.9 tok/s | 172 | 7973 | 1.88 | $0.011723 | honoured |
| minimax-m3 | none | 4/5 | 0/15 | 15/15 | 2013ms | 2000ms | 580ms | 185.6 tok/s | 164 | 5473 | 1.17 | $0.007601 | honoured |
| minimax-m3 | medium | 5/5 | 1/15 | 14/15 | 2114ms | 2031ms | 717ms | 150.4 tok/s | 194 | 7985 | 1.84 | $0.007816 | honoured |
| glm-5.3-flash | default | 4/5 | 0/15 | 12/15 | 2390ms | 2143ms | 416ms | — | 166 | 375 | 1.87 | ~$0.000476 | honoured |
| glm-5.3-flash | high | 5/5 | 0/15 | 15/15 | 2519ms | 1782ms | 3ms | 79.8 tok/s | 103 | 7132 | 0.47 | $0.001337 | honoured |
| minimax-m3 | high | 5/5 | 0/15 | 15/15 | 2770ms | 2755ms | 1146ms | 218.3 tok/s | 189 | 7003 | 2.04 | $0.008098 | honoured |
| minimax-m3 | default | 5/5 | 0/15 | 15/15 | 2951ms | 2941ms | 1004ms | 254.4 tok/s | 176 | 7615 | 1.90 | $0.010156 | honoured |
| gemini-3.8-flash | low | 4/5 | 0/15 | 15/15 | 3106ms | 2242ms | 146ms | 103.7 tok/s | 324 | 1288 | 2.14 | $0.019655 | honoured |
| gemini-3.8-flash | default | 4/5 | 0/15 | 15/15 | 3521ms | 3284ms | 0ms | 101.8 tok/s | 443 | 2348 | 5.40 | $0.025201 | honoured |
| gemini-3.8-flash | medium | 4/5 | 0/15 | 15/15 | 3710ms | 3533ms | 1130ms | 105.6 tok/s | 504 | 1563 | 6.23 | $0.026000 | honoured |
| gemini-3.8-flash | high | 4/5 | 0/15 | 15/15 | 4709ms | 4677ms | 2011ms | 114.1 tok/s | 615 | 3810 | 6.82 | $0.031336 | honoured |
| glm-5.3-flash | medium | — | — | — | — | — | — | — | — | — | — | — | unsupported |

## Per-model effort curve

### gpt-5.6-luna

| effort | pass rate | starved | median wall | completion tok | thinking spread |
|-|-|-|-|-|-|
| default | 14/15 (93%) | 0/15 | 1023ms | 105 | 335 |
| none | 12/15 (80%) | 0/15 | 600ms | 59 | 28 |
| low | 13/15 (87%) | 0/15 | 986ms | 107 | 161 |
| medium | 14/15 (93%) | 0/15 | 1095ms | 106 | 202 |
| high | 13/15 (87%) | 0/15 | 1067ms | 115 | 955 |

### deepseek-v4.1-flash

| effort | pass rate | starved | median wall | completion tok | thinking spread |
|-|-|-|-|-|-|
| default | 12/14 (86%) | 1/15 | 1124ms | 142 | 7974 |
| none | 12/13 (92%) | 2/15 | 668ms | 176 | 7975 |
| low | 12/13 (92%) | 2/15 | 762ms | 146 | 7968 |
| medium | 12/13 (92%) | 2/15 | 737ms | 162 | 7970 |
| high | 13/14 (93%) | 1/15 | 963ms | 153 | 7970 |

### gemini-3.8-flash

| effort | pass rate | starved | median wall | completion tok | thinking spread |
|-|-|-|-|-|-|
| default | 12/15 (80%) | 0/15 | 3521ms | 443 | 2348 |
| none | 12/15 (80%) | 0/15 | 1758ms | 315 | 1650 |
| low | 12/15 (80%) | 0/15 | 3106ms | 324 | 1288 |
| medium | 12/15 (80%) | 0/15 | 3710ms | 504 | 1563 |
| high | 12/15 (80%) | 0/15 | 4709ms | 615 | 3810 |

### glm-5.3-flash

| effort | pass rate | starved | median wall | completion tok | thinking spread |
|-|-|-|-|-|-|
| default | 12/15 (80%) | 0/15 | 2390ms | 166 | 375 |
| none | 15/15 (100%) | 0/15 | 1820ms | 66 | 33 |
| low | 15/15 (100%) | 0/15 | 1802ms | 69 | 48 |
| medium | — | — | — | — | — |
| high | 14/15 (93%) | 0/15 | 2519ms | 103 | 7132 |

### minimax-m3

| effort | pass rate | starved | median wall | completion tok | thinking spread |
|-|-|-|-|-|-|
| default | 14/15 (93%) | 0/15 | 2951ms | 176 | 7615 |
| none | 13/15 (87%) | 0/15 | 2013ms | 164 | 5473 |
| low | 13/13 (100%) | 2/15 | 1896ms | 172 | 7973 |
| medium | 14/14 (100%) | 1/15 | 2114ms | 194 | 7985 |
| high | 14/15 (93%) | 0/15 | 2770ms | 189 | 7003 |

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
