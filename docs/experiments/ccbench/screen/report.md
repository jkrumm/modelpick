# ccbench — screen

Generated 2026-08-31T10:41:56.268Z. 12 model(s) over 2 task(s).

Cost is Anthropic **list pricing** as reported by the CLI (`costBasis: "list"`), not an IU invoice.

## Leaderboard

| model | composite | quality | pass rate | cost (list) | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| kimi-k2.7-code | 0.87 | 1.00 | 100% | $0.129 | 21.8s | 5.50 | 0% |
| DeepSeek-V4-Pro | 0.87 | 1.00 | 100% | $0.246 | 14.9s | 4.50 | 0% |
| DeepSeek-V4-Flash | 0.84 | 1.00 | 100% | $0.329 | 15.6s | 7.00 | 0% |
| minimax-m3 | 0.82 | 1.00 | 100% | $0.189 | 23.2s | 7.50 | 0% |
| glm-5.3-flash | 0.74 | 1.00 | 100% | $0.232 | 42.6s | 5.50 | 0% |
| GLM-5.1 | 0.74 | 1.00 | 100% | $0.207 | 52.7s | 7.50 | 0% |
| MiMo-V2.5-Pro | 0.69 | 1.00 | 100% | $0.321 | 1m 24s | 5.50 | 0% |
| NVIDIA-Nemotron-3-Super-120B-A12B | 0.65 | 0.86 | 50% | $0.703 | 31.6s | 5.50 | 0% |
| hy3 | 0.64 | 0.50 | 50% | $0.199 | 14.9s | 2.00 | 0% |
| qwen3.7-max | 0.56 | 0.50 | 50% | $0.085 | 4m 26s | 5.00 | 0% |
| glm-5.2 | 0.10 | 0.00 | 0% | $0 | 6m 14s | 1.00 | 0% |
| nemotron-3-ultra | 0.10 | 0.00 | 0% | $0 | 5m 60s | 1.00 | 0% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | batch-read |
|-|-|-|
| kimi-k2.7-code | 1.00 y | 1.00 y |
| DeepSeek-V4-Pro | 1.00 y | 1.00 y |
| DeepSeek-V4-Flash | 1.00 y | 1.00 y |
| minimax-m3 | 1.00 y | 1.00 y |
| glm-5.3-flash | 1.00 y | 1.00 y |
| GLM-5.1 | 1.00 y | 1.00 y |
| MiMo-V2.5-Pro | 1.00 y | 1.00 y |
| NVIDIA-Nemotron-3-Super-120B-A12B | 1.00 y | 0.71 n |
| hy3 | 1.00 y | 0.00 n |
| qwen3.7-max | 0.00 n | 1.00 y |
| glm-5.2 | 0.00 n | 0.00 n |
| nemotron-3-ultra | 0.00 n | 0.00 n |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| kimi-k2.7-code | 1.00 | — | — | — | 1.00 | — | — |
| DeepSeek-V4-Pro | 1.00 | — | — | — | 1.00 | — | — |
| DeepSeek-V4-Flash | 1.00 | — | — | — | 1.00 | — | — |
| minimax-m3 | 1.00 | — | — | — | 1.00 | — | — |
| glm-5.3-flash | 1.00 | — | — | — | 1.00 | — | — |
| GLM-5.1 | 1.00 | — | — | — | 1.00 | — | — |
| MiMo-V2.5-Pro | 1.00 | — | — | — | 1.00 | — | — |
| NVIDIA-Nemotron-3-Super-120B-A12B | 1.00 | — | — | — | 0.71 | — | — |
| hy3 | 1.00 | — | — | — | 0.00 | — | — |
| qwen3.7-max | 0.00 | — | — | — | 1.00 | — | — |
| glm-5.2 | 0.00 | — | — | — | 0.00 | — | — |
| nemotron-3-ultra | 0.00 | — | — | — | 0.00 | — | — |

## Failures and notes

- **MiMo-V2.5-Pro / locate #1** — failure: `api_error`
- **glm-5.2 / locate #1** — failure: `api_error`
- **glm-5.2 / batch-read #1** — failure: `api_error`
- **nemotron-3-ultra / locate #1** — failure: `api_error`
- **nemotron-3-ultra / batch-read #1** — failure: `api_error`
- **qwen3.7-max / locate #1** — failure: `timeout`
- qwen3.7-max / locate #1 — stream ended without a result event — metrics reconstructed from a partial transcript
