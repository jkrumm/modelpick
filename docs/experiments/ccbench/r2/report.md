# ccbench — r2

Generated 2026-08-31T08:59:18.615Z. 6 model(s) over 10 task(s).

Cost is Anthropic **list pricing** as reported by the CLI (`costBasis: "list"`), not an IU invoice.

## Leaderboard

| model | composite | quality | pass rate | cost (list) | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| claude-sonnet-5 | 0.96 | 1.00 | 100% | $1.075 | 4m 58s | 10.00 | 2% |
| claude-haiku-4-5 | 0.86 | 1.00 | 100% | $0.881 | 14m 06s | 13.00 | 11% |
| claude-opus-4-8 | 0.84 | 1.00 | 100% | $1.825 | 6m 51s | 7.90 | 4% |
| claude-fable-5 | 0.77 | 1.00 | 100% | $4.190 | 7m 24s | 8.70 | 3% |
| claude-opus-5 | 0.76 | 1.00 | 100% | $2.725 | 10m 14s | 10.30 | 0% |
| claude-sonnet-4-6 | 0.75 | 1.00 | 100% | $1.458 | 29m 25s | 8.80 | 4% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | fix-failing-test | implement-spec | thread-field | batch-read | house-rules | parser-spec | perf-refactor | multi-bug | deep-search |
|-|-|-|-|-|-|-|-|-|-|-|
| claude-sonnet-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-haiku-4-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-opus-4-8 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-fable-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-opus-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-sonnet-4-6 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| claude-sonnet-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-haiku-4-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-opus-4-8 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-fable-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-opus-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-sonnet-4-6 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

## Failures and notes

- **claude-haiku-4-5 / multi-bug #1** — failure: `max_turns`
