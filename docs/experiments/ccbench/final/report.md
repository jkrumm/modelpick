# ccbench — final

Generated 2026-08-31T12:07:10.927Z. 13 model(s) over 10 task(s).

Cost basis is **mixed** across this suite — see the `basis` column. `measured` rows are computed from per-token rates solved from the gateway's own billing (`pick_probe`); `list` rows are Anthropic **list pricing**, which the CLI applies even to ids it has never heard of and therefore over-prices; `unpriced` rows have no rate card at all and render a dash.

## Leaderboard

| model | composite | quality | pass rate | cost | basis | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|-|
| glm-5.3-flash | 0.81 | 0.97 | 90% | $0.035 | mixed | 38m 24s | 10.10 | 0% |
| claude-sonnet-5 | 0.80 | 1.00 | 100% | $1.127 | list | 5m 03s | 8.70 | 3% |
| minimax-m3 | 0.78 | 1.00 | 100% | $0.194 | measured | 6m 51s | 12.60 | 3% |
| kimi-k2.7-code | 0.76 | 1.00 | 100% | $0.307 | measured | 6m 51s | 12.10 | 6% |
| claude-opus-4-8 | 0.75 | 1.00 | 100% | $1.733 | list | 6m 46s | 8.50 | 4% |
| claude-sonnet-4-6 | 0.72 | 1.00 | 100% | $1.256 | list | 8m 12s | 8.00 | 5% |
| claude-opus-5 | 0.71 | 1.00 | 100% | $2.544 | list | 9m 43s | 9.80 | 1% |
| GLM-5.1 | 0.70 | 1.00 | 100% | $0.335 | measured | 11m 41s | 9.30 | 5% |
| claude-haiku-4-5 | 0.70 | 1.00 | 100% | $0.606 | list | 10m 28s | 11.30 | 9% |
| DeepSeek-V4-Flash | 0.70 | 1.00 | 100% | $0.666 | measured | 11m 04s | 12.30 | 4% |
| claude-fable-5 | 0.69 | 1.00 | 100% | $4.460 | list | 10m 24s | 8.50 | 4% |
| DeepSeek-V4-Pro | 0.68 | 1.00 | 100% | $0.664 | measured | 13m 22s | 11.10 | 2% |
| MiMo-V2.5-Pro | 0.44 | 0.64 | 50% | $0.541 | mixed | 61m 27s | 6.70 | 4% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | fix-failing-test | implement-spec | thread-field | batch-read | house-rules | parser-spec | perf-refactor | multi-bug | deep-search |
|-|-|-|-|-|-|-|-|-|-|-|
| glm-5.3-flash | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 0.67 n | 1.00 y | 1.00 y |
| claude-sonnet-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| minimax-m3 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| kimi-k2.7-code | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-opus-4-8 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-sonnet-4-6 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-opus-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| GLM-5.1 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-haiku-4-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| DeepSeek-V4-Flash | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| claude-fable-5 | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| DeepSeek-V4-Pro | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y | 1.00 y |
| MiMo-V2.5-Pro | 0.00 n | 0.56 n | 0.14 n | 1.00 y | 0.00 n | 1.00 y | 1.00 y | 0.67 n | 1.00 y | 1.00 y |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| glm-5.3-flash | 1.00 | 0.94 | 1.00 | 1.00 | 1.00 | 1.00 | 0.89 |
| claude-sonnet-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| minimax-m3 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| kimi-k2.7-code | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-opus-4-8 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-sonnet-4-6 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-opus-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| GLM-5.1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-haiku-4-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| DeepSeek-V4-Flash | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| claude-fable-5 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| DeepSeek-V4-Pro | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| MiMo-V2.5-Pro | 0.50 | 0.73 | 1.00 | 0.78 | 0.00 | 1.00 | 0.89 |

## Failures and notes

- **claude-haiku-4-5 / multi-bug #1** — failure: `max_turns`
- **glm-5.3-flash / parser-spec #1** — failure: `timeout`
- glm-5.3-flash / parser-spec #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- **glm-5.3-flash / perf-refactor #1** — failure: `timeout`
- glm-5.3-flash / perf-refactor #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- **MiMo-V2.5-Pro / locate #1** — failure: `timeout`
- MiMo-V2.5-Pro / locate #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- **MiMo-V2.5-Pro / fix-failing-test #1** — failure: `api_error`
- **MiMo-V2.5-Pro / implement-spec #1** — failure: `api_error`
- **MiMo-V2.5-Pro / thread-field #1** — failure: `timeout`
- MiMo-V2.5-Pro / thread-field #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- **MiMo-V2.5-Pro / batch-read #1** — failure: `timeout`
- MiMo-V2.5-Pro / batch-read #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- **MiMo-V2.5-Pro / house-rules #1** — failure: `timeout`
- MiMo-V2.5-Pro / house-rules #1 — stream ended without a result event — metrics reconstructed from a partial transcript
- **MiMo-V2.5-Pro / parser-spec #1** — failure: `api_error`
- **MiMo-V2.5-Pro / perf-refactor #1** — failure: `api_error`
- **MiMo-V2.5-Pro / multi-bug #1** — failure: `api_error`
- **MiMo-V2.5-Pro / deep-search #1** — failure: `timeout`
