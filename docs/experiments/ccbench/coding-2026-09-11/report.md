# ccbench — coding-2026-09-11

Generated 2026-09-11T14:06:11.764Z. 4 model(s) over 10 task(s).

Cost basis is **mixed** across this suite — see the `basis` column. `measured` rows are computed from per-token rates solved from the gateway's own billing (`pick_probe`); `list` rows are Anthropic **list pricing**, which the CLI applies even to ids it has never heard of and therefore over-prices; `unpriced` rows have no rate card at all and render a dash.

## Leaderboard

| model | composite | quality | pass rate | cost | basis | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|-|
| minimax-m3 | 0.82 | 1.00 | 100% | $0.164 | measured | 5m 29s | 12.00 | 2% |
| glm-5.3-flash | 0.78 | 0.91 | 90% | $0.016 | mixed | 40m 22s | 9.80 | 1% |
| kimi-k2.7-code | 0.72 | 1.00 | 100% | $0.354 | measured | 9m 23s | 11.30 | 3% |
| DeepSeek-V4-Pro | 0.68 | 1.00 | 100% | $0.774 | measured | 13m 36s | 12.50 | 0% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | fix-failing-test | implement-spec | thread-field | batch-read | house-rules | parser-spec | perf-refactor | multi-bug | deep-search |
|-|-|-|-|-|-|-|-|-|-|-|
| minimax-m3 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| glm-5.3-flash | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 0.11 n | 1.00 y | 1.00 y |
| kimi-k2.7-code | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| DeepSeek-V4-Pro | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| minimax-m3 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| glm-5.3-flash | 1.00 | 0.85 | 1.00 | 1.00 | 1.00 | 1.00 | 0.70 |
| kimi-k2.7-code | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| DeepSeek-V4-Pro | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

## Failures and notes

- **glm-5.3-flash / implement-spec #1** — failure: `timeout`
- glm-5.3-flash / implement-spec #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- **glm-5.3-flash / house-rules #1** — failure: `timeout`
- glm-5.3-flash / house-rules #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- **glm-5.3-flash / parser-spec #1** — failure: `timeout`
- glm-5.3-flash / parser-spec #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- **glm-5.3-flash / perf-refactor #1** — failure: `timeout`
- glm-5.3-flash / perf-refactor #1 — stream ended without a result event — metrics reconstructed from a partial transcript
