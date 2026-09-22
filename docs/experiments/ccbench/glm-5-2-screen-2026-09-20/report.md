# ccbench — glm-5-2-screen-2026-09-20

Generated 2026-09-20T15:39:05.189Z. 1 model(s) over 2 task(s).

Cost basis: **unpriced** — no rate card resolved for any model in this suite, so every cost cell is a dash.

## Leaderboard

| model | composite | quality | pass rate | cost | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| glm-5.2 | 0.10 | 0.00 | 0% | — | 6m 13s | 1.00 | 0% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | batch-read |
|-|-|-|
| glm-5.2 | 0.00 n | 0.00 n |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| glm-5.2 | 0.00 | — | — | — | 0.00 | — | — |

## Failures and notes

- **glm-5.2 / locate #1** — failure: `api_error`
- glm-5.2 / locate #1 — diagnostic: kill=none (not killed), 1 turn(s) observed, stream ended on a result event, 0 thinking-token telemetry event(s), last event type "result", sandbox kept at /tmp/ccbench/glm-5-2-screen-2026-09-20/glm-5_2/locate-1
- **glm-5.2 / batch-read #1** — failure: `api_error`
- glm-5.2 / batch-read #1 — diagnostic: kill=none (not killed), 1 turn(s) observed, stream ended on a result event, 0 thinking-token telemetry event(s), last event type "result", sandbox kept at /tmp/ccbench/glm-5-2-screen-2026-09-20/glm-5_2/batch-read-1
