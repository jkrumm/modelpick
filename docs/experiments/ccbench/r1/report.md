# ccbench — r1

Generated 2026-08-31T08:12:01.837Z. 6 model(s) over 6 task(s).

Cost is Anthropic **list pricing** as reported by the CLI (`costBasis: "list"`), not an IU invoice.

## Leaderboard

| model | composite | quality | pass rate | cost (list) | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| claude-haiku-4-5 | 0.90 | 1.00 | 100% | $0.272 | 4m 17s | 8.83 | 9% |
| claude-sonnet-5 | 0.89 | 1.00 | 100% | $0.560 | 2m 24s | 7.00 | 3% |
| claude-opus-4-8 | 0.82 | 1.00 | 100% | $0.875 | 2m 51s | 7.33 | 5% |
| claude-opus-5 | 0.79 | 1.00 | 100% | $1.066 | 3m 18s | 9.17 | 2% |
| claude-fable-5 | 0.77 | 1.00 | 100% | $2.039 | 3m 16s | 7.00 | 3% |
| claude-sonnet-4-6 | 0.74 | 1.00 | 100% | $0.593 | 9m 18s | 7.17 | 3% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | fix-failing-test | implement-spec | thread-field | batch-read | house-rules |
|-|-|-|-|-|-|-|
| claude-haiku-4-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-sonnet-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-opus-4-8 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-opus-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-fable-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-sonnet-4-6 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence |
|-|-|-|-|-|-|-|
| claude-haiku-4-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-sonnet-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-opus-4-8 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-opus-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-fable-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-sonnet-4-6 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

## Failures and notes

No failures, no parser notes - every run produced a clean transcript.
