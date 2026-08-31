# ccbench — eu2

Generated 2026-08-31T09:46:57.316Z. 2 model(s) over 2 task(s).

Cost is Anthropic **list pricing** as reported by the CLI (`costBasis: "list"`), not an IU invoice.

## Leaderboard

| model | composite | quality | pass rate | cost (list) | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| claude-haiku-4-5-eu | 0.10 | 0.00 | 0% | $0.0043 | 13m 42s | 1.00 | 0% |
| claude-opus-4-8-eu | 0.10 | 0.00 | 0% | $0 | 12m 53s | 1.00 | 0% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | batch-read |
|-|-|-|
| claude-haiku-4-5-eu | 0.00 n | 0.00 n |
| claude-opus-4-8-eu | 0.00 n | 0.00 n |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| claude-haiku-4-5-eu | 0.00 | — | — | — | 0.00 | — | — |
| claude-opus-4-8-eu | 0.00 | — | — | — | 0.00 | — | — |

## Failures and notes

- **claude-opus-4-8-eu / locate #1** — failure: `api_error`
- **claude-opus-4-8-eu / locate #2** — failure: `api_error`
- **claude-opus-4-8-eu / batch-read #1** — failure: `api_error`
- **claude-opus-4-8-eu / batch-read #2** — failure: `api_error`
- **claude-haiku-4-5-eu / locate #1** — failure: `api_error`
- **claude-haiku-4-5-eu / locate #2** — failure: `api_error`
- **claude-haiku-4-5-eu / batch-read #1** — failure: `api_error`
- **claude-haiku-4-5-eu / batch-read #2** — failure: `api_error`
