# ccbench — tmo

Generated 2026-08-31T14:44:14.217Z. 1 model(s) over 2 task(s).

Cost basis: **measured** — computed from this model's own per-token rates (`pick_probe`, solved from the gateway's billing), not an IU invoice.

## Leaderboard

| model | composite | quality | pass rate | cost (measured) | wall | mean turns | tool err |
|-|-|-|-|-|-|-|-|
| glm-5.3-flash | 0.99 | 1.00 | 100% | $0.085 | 101m 20s | 14.75 | 9% |

## Per-task scores

Cell is the mean score across attempts, followed by `y` when every attempt passed.

| model | parser-spec | perf-refactor |
|-|-|-|
| glm-5.3-flash | 1.00 y | 1.00 y |

## Per-dimension scores

| model | search | coding | multi_file | recovery | tool_use | adherence | reasoning |
|-|-|-|-|-|-|-|-|
| glm-5.3-flash | — | 1.00 | — | — | — | — | 1.00 |

## Failures and notes

No failures, no parser notes - every run produced a clean transcript.
