# ccbench — eu

Generated 2026-08-31T09:32:29.773Z. 8 model(s) over 3 task(s).

Cost is Anthropic **list pricing** as reported by the CLI (`costBasis: "list"`), not an IU invoice.

## Leaderboard

| model | composite | quality | pass rate | cost (list) | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| claude-sonnet-5 | 0.79 | 0.97 | 67% | $0.622 | 1m 45s | 5.67 | 2% |
| claude-opus-4-8 | 0.74 | 1.00 | 100% | $0.930 | 2m 29s | 6.67 | 0% |
| claude-haiku-4-5 | 0.70 | 1.00 | 100% | $0.303 | 3m 44s | 7.44 | 3% |
| claude-sonnet-4-6 | 0.64 | 1.00 | 100% | $0.762 | 8m 51s | 5.89 | 0% |
| claude-sonnet-4-6-eu | 0.64 | 1.00 | 100% | $0.655 | 10m 17s | 5.89 | 0% |
| claude-opus-5 | 0.60 | 0.89 | 67% | $1.009 | 6m 32s | 7.33 | 0% |
| claude-opus-4-8-eu | 0.35 | 0.08 | 0% | $0 | 28m 21s | 1.00 | 0% |
| claude-haiku-4-5-eu | 0.35 | 0.08 | 0% | $0.010 | 30m 01s | 1.00 | 0% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | locate | batch-read | thread-field |
|-|-|-|-|
| claude-sonnet-5 | 1.00 y | 0.90 n | 1.00 y |
| claude-opus-4-8 | 1.00 y | 1.00 y | 1.00 y |
| claude-haiku-4-5 | 1.00 y | 1.00 y | 1.00 y |
| claude-sonnet-4-6 | 1.00 y | 1.00 y | 1.00 y |
| claude-sonnet-4-6-eu | 1.00 y | 1.00 y | 1.00 y |
| claude-opus-5 | 0.67 n | 1.00 y | 1.00 y |
| claude-opus-4-8-eu | 0.00 n | 0.00 n | 0.25 n |
| claude-haiku-4-5-eu | 0.00 n | 0.00 n | 0.25 n |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| claude-sonnet-5 | 1.00 | 1.00 | 1.00 | — | 0.90 | — | — |
| claude-opus-4-8 | 1.00 | 1.00 | 1.00 | — | 1.00 | — | — |
| claude-haiku-4-5 | 1.00 | 1.00 | 1.00 | — | 1.00 | — | — |
| claude-sonnet-4-6 | 1.00 | 1.00 | 1.00 | — | 1.00 | — | — |
| claude-sonnet-4-6-eu | 1.00 | 1.00 | 1.00 | — | 1.00 | — | — |
| claude-opus-5 | 0.67 | 1.00 | 1.00 | — | 1.00 | — | — |
| claude-opus-4-8-eu | 0.00 | 0.25 | 0.25 | — | 0.00 | — | — |
| claude-haiku-4-5-eu | 0.00 | 0.25 | 0.25 | — | 0.00 | — | — |

## Failures and notes

- **claude-haiku-4-5-eu / locate #1** — failure: `api_error`
- **claude-haiku-4-5-eu / locate #2** — failure: `api_error`
- **claude-haiku-4-5-eu / locate #3** — failure: `api_error`
- **claude-haiku-4-5-eu / batch-read #1** — failure: `api_error`
- **claude-haiku-4-5-eu / batch-read #2** — failure: `api_error`
- **claude-haiku-4-5-eu / batch-read #3** — failure: `api_error`
- **claude-haiku-4-5-eu / thread-field #1** — failure: `api_error`
- **claude-haiku-4-5-eu / thread-field #2** — failure: `api_error`
- **claude-haiku-4-5-eu / thread-field #3** — failure: `api_error`
- **claude-opus-4-8-eu / locate #1** — failure: `api_error`
- **claude-opus-4-8-eu / locate #2** — failure: `api_error`
- **claude-opus-4-8-eu / locate #3** — failure: `api_error`
- **claude-opus-4-8-eu / batch-read #1** — failure: `api_error`
- **claude-opus-4-8-eu / batch-read #2** — failure: `api_error`
- **claude-opus-4-8-eu / batch-read #3** — failure: `api_error`
- **claude-opus-4-8-eu / thread-field #1** — failure: `api_error`
- **claude-opus-4-8-eu / thread-field #2** — failure: `api_error`
- **claude-opus-4-8-eu / thread-field #3** — failure: `api_error`
- **claude-opus-5 / locate #3** — failure: `timeout`
- claude-opus-5 / locate #3 — stream ended without a result event — metrics reconstructed from a partial transcript
