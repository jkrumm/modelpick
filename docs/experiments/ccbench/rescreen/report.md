# ccbench — rescreen

Generated 2026-08-31T15:29:11.905Z. 2 model(s) over 3 task(s).

Cost basis: **unpriced** — no rate card resolved for any model in this suite, so every cost cell is a dash.

## Leaderboard

| model | composite | quality | pass rate | cost | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| glm-5.2 | 0.54 | 0.08 | 0% | — | 9m 14s | 1.00 | 0% |
| nemotron-3-ultra | 0.54 | 0.08 | 0% | — | 9m 19s | 1.00 | 0% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | batch-read | thread-field |
|-|-|-|-|
| glm-5.2 | 0.00 n | 0.00 n | 0.25 n |
| nemotron-3-ultra | 0.00 n | 0.00 n | 0.25 n |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| glm-5.2 | 0.00 | 0.25 | 0.25 | — | 0.00 | — | — |
| nemotron-3-ultra | 0.00 | 0.25 | 0.25 | — | 0.00 | — | — |

## Failures and notes

- **glm-5.2 / locate #1** — failure: `api_error`
- **glm-5.2 / batch-read #1** — failure: `api_error`
- **glm-5.2 / thread-field #1** — failure: `api_error`
- **nemotron-3-ultra / locate #1** — failure: `api_error`
- **nemotron-3-ultra / batch-read #1** — failure: `api_error`
- **nemotron-3-ultra / thread-field #1** — failure: `api_error`
