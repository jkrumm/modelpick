# Subscription quota vs API price — what is known (2026-11-17)

> **Current verdict (2026-11-17):** Anthropic publishes no per-model, per-effort or cache-read weight for
> subscription limits, and nobody has measured a Haiku-vs-Sonnet tasks-per-window ratio. API price is
> the best available proxy, not a measurement. Treat `$ per task` as the ranking signal and say so.
> **Re-open when:** Anthropic publishes the weights, or one same-week A/B of identical tasks with
> `/usage` readings exists (see "How to measure" below).
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

## What Anthropic says

- Quota use depends on conversation length, features, **model** and **effort**; higher effort "uses more
  tokens, so you'll reach your usage limits faster". Opus "uses meaningfully more" than Sonnet.
- Subagent cost page: choosing a smaller subagent model spends less quota. That is the only official
  statement that a smaller model costs less quota, and it carries no ratio.
- Thinking cannot be turned off on Haiku 5.5, Sonnet 5.5 or Opus 5.5 in Claude Code; effort is the only lever.
- Cache reads count (a re-read "still draws usage for the whole conversation"), at an unpublished reduced
  weight. List cache-read ratio: 0.05x input for Sonnet 5.5, 0.1x for Haiku 5.5.

## Per-task data (CursorBench 4.0, Cursor's harness, via Epoch AI, CC-BY 4.0)

| config | score | cost/task | tokens/task | steps |
|-|-|-|-|-|
| Haiku 5.5 high | 0.423 | $0.32 | 77k | 59 |
| Haiku 5.5 xhigh | 0.443 | $0.56 | 144k | 93 |
| Sonnet 5.5 medium | 0.392 | $0.52 | 16k | 22 |
| Sonnet 5.5 high | 0.478 | $1.20 | 37k | 41 |

Haiku high is cheaper per task than Sonnet medium at a higher score, with 4.8x the tokens. Whether that
saves *subscription* quota depends on whether the meter counts tokens (Haiku loses) or price-weighted
tokens (Haiku wins, about 0.6x Sonnet medium). The community fits point to price-weighted, but they
disagree by about 6x on Haiku, come from single users, and drift between windows. The tokens column is
not billed tokens (Cursor does not define it), so it cannot stand in for quota.

## Traps

- Since mid-October 2026 many Max/Ultra users report the same workload draining the weekly meter 1.5 to 5x
  faster, with no published cause. Burn comparisons across weeks are confounded; compare within one week.
- Haiku 5.5 bills 5x above 100k input tokens on the API; whether the subscription meter applies the tier
  is not stated.
- "Max 20x" is now named Ultra (community reports, Oct 30; not confirmed by Anthropic).
- Long sessions are dominated by cache re-reads whatever the model; clearing context and using subagents
  targets that.

## How to measure

Same week, same seat, identical task, one config per run: read `/usage` five-hour and weekly percentages
before and after, repeat until the delta clears the 1-point resolution. Record per config, and keep the
raw numbers in `docs/experiments/`.
