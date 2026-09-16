# ccbench — glm-slowclock-2026-09-11

Generated 2026-09-11T15:36:31.352Z. 1 model(s) over 10 task(s).

Cost basis is **mixed** across this suite — see the `basis` column. `measured` rows are computed from per-token rates solved from the gateway's own billing (`pick_probe`); `list` rows are Anthropic **list pricing**, which the CLI applies even to ids it has never heard of and therefore over-prices; `unpriced` rows have no rate card at all and render a dash.

## Leaderboard

| model | composite | quality | pass rate | cost | basis | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|-|
| glm-5.3-flash | 0.99 | 1.00 | 100% | $0.048 | mixed | 66m 31s | 12.80 | 7% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | fix-failing-test | implement-spec | thread-field | batch-read | house-rules | parser-spec | perf-refactor | multi-bug | deep-search |
|-|-|-|-|-|-|-|-|-|-|-|
| glm-5.3-flash | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| glm-5.3-flash | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

## Failures and notes

- **glm-5.3-flash / parser-spec #1** — failure: `api_error`
- **glm-5.3-flash / perf-refactor #1** — failure: `timeout`
- glm-5.3-flash / perf-refactor #1 — stream ended without a result event — metrics reconstructed from a partial transcript
