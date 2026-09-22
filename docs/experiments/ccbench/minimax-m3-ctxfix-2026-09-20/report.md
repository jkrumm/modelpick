# ccbench — minimax-m3-ctxfix-2026-09-20

Generated 2026-09-20T15:37:12.001Z. 1 model(s) over 10 task(s).

Cost basis: **measured** — computed from this model's own per-token rates (`pick_probe`, solved from the gateway's billing), not an IU invoice.

## Leaderboard

| model | composite | quality | pass rate | cost (measured) | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| minimax-m3 | 0.96 | 0.93 | 90% | $0.198 | 6m 08s | 13.70 | 2% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | fix-failing-test | implement-spec | thread-field | batch-read | house-rules | parser-spec | perf-refactor | multi-bug | deep-search |
|-|-|-|-|-|-|-|-|-|-|-|
| minimax-m3 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 0.33 n | 1.00 y | 1.00 y |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| minimax-m3 | 1.00 | 0.89 | 1.00 | 1.00 | 1.00 | 1.00 | 0.78 |

## Failures and notes

No failures, no parser notes - every run produced a clean transcript.
