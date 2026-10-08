# bench-fast report

Generated 2026-10-08T10:26:00.946Z. Models: gpt-6-luna. Tasks: extract, reason, classify, instruct, longform. Repeats: 3.

## Crossover: does the faster decoder actually win?

For each candidate against `gpt-5.6-luna`, the output length (in visible
tokens) beyond which a later-starting, faster-decoding model overtakes the
earlier-starting one — derived from each model's `default`-effort median
TTFT and decode rate. `crossover_tokens = (ttft_B - ttft_A) / (1/rate_A -
1/rate_B)`, where A is the later-starting/faster-decoding model.

- **gpt-6-luna**: n/a — no `default`-effort data for this model or the baseline.

## Headline

| model | effort | pass | starved | timed | median wall | median ttft | median think | decode tok/s | completion tok | think spread | think:visible | $/run | verdict |
|-|-|-|-|-|-|-|-|-|-|-|-|-|-|
| gpt-6-luna | none | 5/5 | 0/15 | 15/15 | 1111ms | 1071ms | 606ms | 13603.9 tok/s | 52 | 29 | 0.02 | $0.001115 | honoured |
| gpt-6-luna | low | 5/5 | 0/15 | 15/15 | 1285ms | 1278ms | 414ms | 13608.1 tok/s | 73 | 222 | 0.41 | $0.001216 | honoured |
| gpt-6-luna | medium | 5/5 | 0/15 | 15/15 | 1535ms | 1525ms | 491ms | 12072.2 tok/s | 108 | 653 | 0.63 | $0.001364 | honoured |
| gpt-6-luna | default | 5/5 | 0/15 | 15/15 | 1539ms | 1533ms | 488ms | 15090.5 tok/s | 108 | 718 | 0.61 | $0.001359 | honoured |
| gpt-6-luna | high | 5/5 | 0/15 | 15/15 | 1827ms | 1809ms | 358ms | 15046.5 tok/s | 116 | 961 | 0.85 | $0.001584 | honoured |

## Per-model effort curve

### gpt-6-luna

| effort | pass rate | starved | median wall | completion tok | thinking spread |
|-|-|-|-|-|-|
| default | 15/15 (100%) | 0/15 | 1539ms | 108 | 718 |
| none | 15/15 (100%) | 0/15 | 1111ms | 52 | 29 |
| low | 15/15 (100%) | 0/15 | 1285ms | 73 | 222 |
| medium | 15/15 (100%) | 0/15 | 1535ms | 108 | 653 |
| high | 15/15 (100%) | 0/15 | 1827ms | 116 | 961 |

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
