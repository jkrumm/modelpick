# ccbench — deepseek-v4-pro-ctxfix-2026-09-20

Generated 2026-09-20T15:47:14.826Z. 1 model(s) over 10 task(s).

Cost basis is **mixed** across this suite — see the `basis` column. `measured` rows are computed from per-token rates solved from the gateway's own billing (`pick_probe`); `list` rows are Anthropic **list pricing**, which the CLI applies even to ids it has never heard of and therefore over-prices; `unpriced` rows have no rate card at all and render a dash.

## Leaderboard

| model | composite | quality | pass rate | cost | basis | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|-|
| DeepSeek-V4-Pro | 1.00 | 1.00 | 100% | $0.669 | mixed | 19m 11s | 12.80 | 3% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | fix-failing-test | implement-spec | thread-field | batch-read | house-rules | parser-spec | perf-refactor | multi-bug | deep-search |
|-|-|-|-|-|-|-|-|-|-|-|
| DeepSeek-V4-Pro | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| DeepSeek-V4-Pro | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

## Failures and notes

- **DeepSeek-V4-Pro / perf-refactor #1** — failure: `idle_stall`
- DeepSeek-V4-Pro / perf-refactor #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- DeepSeek-V4-Pro / perf-refactor #1 — diagnostic: kill=idle (300s idle at kill), 9 turn(s) observed, stream ended without a result event, 12625 thinking-token telemetry event(s), last event type "system", sandbox kept at /tmp/ccbench/deepseek-v4-pro-ctxfix-2026-09-20/DeepSeek-V4-Pro/perf-refactor-1
