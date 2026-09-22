# ccbench — kimi-k2-7-code-ctxfix-2026-09-20

Generated 2026-09-20T15:37:26.895Z. 1 model(s) over 10 task(s).

Cost basis: **measured** — computed from this model's own per-token rates (`pick_probe`, solved from the gateway's billing), not an IU invoice.

## Leaderboard

| model | composite | quality | pass rate | cost (measured) | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| kimi-k2.7-code | 0.95 | 0.91 | 90% | $0.303 | 5m 59s | 10.40 | 3% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | fix-failing-test | implement-spec | thread-field | batch-read | house-rules | parser-spec | perf-refactor | multi-bug | deep-search |
|-|-|-|-|-|-|-|-|-|-|-|
| kimi-k2.7-code | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 0.14 n |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| kimi-k2.7-code | 0.57 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.71 |

## Failures and notes

No failures, no parser notes - every run produced a clean transcript.
