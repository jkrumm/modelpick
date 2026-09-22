# ccbench — deepseek-v4-flash-ctxfix-2026-09-20

Generated 2026-09-20T15:37:07.363Z. 1 model(s) over 10 task(s).

Cost basis: **measured** — computed from this model's own per-token rates (`pick_probe`, solved from the gateway's billing), not an IU invoice.

## Leaderboard

| model | composite | quality | pass rate | cost (measured) | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| DeepSeek-V4-Flash | 1.00 | 1.00 | 100% | $0.090 | 6m 20s | 14.80 | 4% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | fix-failing-test | implement-spec | thread-field | batch-read | house-rules | parser-spec | perf-refactor | multi-bug | deep-search |
|-|-|-|-|-|-|-|-|-|-|-|
| DeepSeek-V4-Flash | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| DeepSeek-V4-Flash | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

## Failures and notes

No failures, no parser notes - every run produced a clean transcript.
