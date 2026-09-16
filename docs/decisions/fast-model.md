# Fast Model — DeepSeek-V4-Flash holds against GLM-5.2

> **Current verdict (2026-09-13):** the `fast` pick is `deepseek-v4.1-flash` at
> `reasoning_effort: high` — an owner decision for capability over cost, not a benchmark result.
> The measurements below still stand: `gpt-5.6-luna` is the fastest model clearing every task
> and the cheapest at Hermes's context scale; `glm-5.3-flash` at `low` is cheapest in isolation.
> See [hermes-brain.md](./hermes-brain.md) §2026-09-13 for the decision and its reasoning.
> **Status of this record:** superseded again — the 2026-09-12 verdict for `gpt-5.6-luna` below
> is the losing side of a deliberate cost/capability tradeoff, not a mistake.
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

**Current:** `DeepSeek-V4-Flash`, unchanged since 2026-06-02. This record exists because the
2026-08-02 refresh recommended **GLM-5.2** instead, and the recommendation was wrong. Keeping
why it was wrong so the next refresh that surfaces it has an answer already written down.

## What the recommender saw

| | Flash | GLM-5.2 |
|-|-|-|
| AA quality | 49.9 | 51.1 |
| AA coding index | 69.1 | 68.8 |
| AA throughput | **0.0** (invalid) | 141.76 |
| AA latency_p50 | **0.0** (invalid) | 0.948s |
| price_in / price_out (OpenRouter) | $0.09–0.14 / $0.18–0.28 | $0.335 / $1.05 |
| price_in / price_out (AA) | $0.14 / $0.28 | $1.40 / $4.40 |

GLM-5.2 scored 0.702 against Flash's lower number on the `fast` profile (quality 0.25, cost
0.40, speed 0.35).

## What live measurement says

`bun run benchmark`, both models, same 3-turn scenario against the IU endpoint, 2026-08-02:

| | Flash | GLM-5.2 |
|-|-|-|
| Decode throughput, avg | **197.0 tok/s** | 37.7 tok/s |
| Worst turn | 152.5 tok/s | 46.7 tok/s (its best) |
| TTFT | 6169ms avg | **not reported at all** |

**GLM-5.2 runs at 37.7 tok/s on IU against ArtificialAnalysis's claimed 141.76 — a 3.8×
overstatement.** This is the second time AA has overstated this exact model: the 2026-07-11
bake-off ([hermes-brain.md](./hermes-brain.md)) caught a claimed ~175 tok/s measuring 106.2.
GLM also returns no time-to-first-token the benchmark can capture, so its flattering
`latency_p50` of 0.948s is AA's number with no independent check behind it.

Two caveats on the Flash column, neither of which changes the outcome: its throughput is
inflated because IU counts reasoning tokens in the completion (one turn returned 1051 tokens
against a 600 cap — same artifact as `hermes-brain.md`), and its TTFT varies widely (2639ms
measured four hours earlier the same day). GLM hit the 600-token cap on every turn and still
took 3–5× longer to get there.

## Verdict

> **Superseded** — see §2026-09-12: superseded — the `fast` pick is `gpt-5.6-luna`, and
> `DeepSeek-V4-Flash` was running nothing. Kept for the measurements; the conclusion below did
> not survive.

**Stay on `DeepSeek-V4-Flash`.** 5× slower live and 3.75–15× more expensive on output is not a
tradeoff, whichever price source you believe — and the two sources disagreeing 4× with each
other is its own reason for caution.

## The scoring bug this exposed

Three things compounded to produce the wrong recommendation, and one of them was a real defect:

1. **Live TTFT fed nothing.** `benchmark-throughput.ts` writes `ttft_ms`; `normalize.ts` only
   read `latency_p50`. Every live latency measurement ever taken — including the ones that
   decided the Hermes brain switch — was ignored by the scorer. **Fixed 2026-08-02:**
   `rawLatency` now prefers live `ttft_ms` over the leaderboard's `latency_p50`, which also
   matches the stated principle that external benchmarks don't reflect what IU actually
   serves. With the fix, `fast` returns to Flash (0.712 vs GLM's 0.702) with no change to the
   committed stack.
2. **Flash's AA rows were zeroed.** Both its AA throughput and latency came back `0.0` and
   were correctly dropped as invalid, so Flash lost the 60%-weighted latency term entirely
   while GLM kept a near-maximal one. A model with *no* data was outranked by a model with
   *wrong* data — the fix above closes this by giving Flash its own measured latency.
3. **Log-scale price normalization compresses real cost gaps.** `minmaxLog` spans a field from
   ~$0.01 to ~$168, so a genuine 3.75× difference in output price barely moves the cost
   dimension. Left alone — the log scale exists for a good reason (a few ultra-premium models
   would otherwise flatten everything else into "cheap"), and this record is the compensating
   control rather than a tuning change made in reaction to one bad recommendation.

## 2026-09-11: `deepseek-v4.1-flash` does not take the slot, and the recommender now says Luna

DeepSeek shipped V4.1 Flash; it is on IU's `/openai/v1` route (not `/anthropic`, so ccbench
cannot score it). Live numbers from the same-day bake-off in
[hermes-brain.md](./hermes-brain.md), plus this repo's own tool-calling scenario:

| | V4 Flash (the pick) | V4.1 Flash | gpt-5.6-luna |
|-|-|-|-|
| AA intelligence (new scale) | 34.5 | **39.5** | 37.5 |
| list price in/out per MTok | $0.44 / $1.32 | $0.30 / $1.20 | **$0.20 / $1.20** |
| live time to first *visible* token | 5,823ms | 13,542ms | **819ms** |
| think/visible ratio | — | 0.78 | **0.09** |
| cached input | — | reported, billed at full rate | **$0.02/MTok, 99.9% hit** |
| 3-tool scenario | **2/3 tools** (dropped `create_task`) | 3/3, 21.4s | 3/3, **6.6s** |
| `fast` profile score | 0.647 | 0.527 | **0.692** |

V4.1 is the better *model* — it fixes the tool-dropping defect that has followed V4 Flash
since the 2026-08-31 ccbench suite, and it is cheaper and smarter on paper. It loses the `fast`
slot on the one dimension this profile weights at 0.35: it emits ~1,400 reasoning tokens before
the first visible one, and `reasoning_effort: low` only moves the think/visible ratio 0.78 →
0.70, so there is no lever to turn that off. That column is thinking time, not gateway latency
— its first SSE frame arrives in 549ms — and it is not comparable to a leaderboard TTFT
column, which measures the first *reasoning* token. See [../pipelines.md](../pipelines.md).

**The recommender has been saying `gpt-5.6-luna` for `fast` since 2026-09-04** (0.692 vs
V4-Flash's 0.647), and today's measurements agree: Luna is faster to first token by 7×,
cheaper once caching and thinking are counted, EU-resident (`x-ms-region: Sweden Central`
against V4.1's `Requesty-Global` → `accounts/fireworks/models/deepseek-v4p1-flash`), and it
did not drop a tool. The 2026-08-02 "stay on Flash" verdict above was about GLM-5.2 and still
reads correctly for that comparison — it is not an argument against Luna, which did not exist
on IU at the time.

**Open:** the committed `fast` pick in `MY_STACK` is still `DeepSeek-V4-Flash` with
`Residency unverified` in its env note. The drift flag on `/stack` is real, not an artifact.

## 2026-09-12: superseded — the `fast` pick is `gpt-5.6-luna`, and `DeepSeek-V4-Flash` was running nothing

This record held `DeepSeek-V4-Flash` against a GLM-5.2 recommendation. The deployment table
built on 2026-09-12 settled it a different way: a sweep of every consuming repo found
**`DeepSeek-V4-Flash` wired into zero jobs**. It survives only in context-window lookup tables
(`dotfiles/config/zsh/claude.zsh`, `dotfiles/scripts/agent-dispatch.sh`,
`sideclaw/server/mcp/session-runner.ts`) and in this repo's own benchmark scripts. Every actual
fast-tier slot — research lead and worker, argo `/ai/v1`, warden `propose_mappings`,
audio-gateway's prep/outline/editorial/metadata passes, the Hermes brain and its aux lanes —
had already moved to `gpt-5.6-luna`, twelve slots in total. The recommender had said Luna since
2026-09-04. The category row was the last thing still claiming otherwise.

**Why not `deepseek-v4.1-flash`**, the natural successor, which is on the `/openai` route where
most of these slots live: it was bake-offed against Luna on 2026-09-11 and lost on every axis
that matters for this tier — 13.5s to the first visible token against Luna's 0.82s, a
think/visible ratio of 0.78 that `reasoning_effort` barely moves (0.78 → 0.70, and Requesty
accepts the parameter without applying it), 3.7× the measured cost over a 3-turn conversation
despite a near-identical rate card, and no cached-input rate at all — so a warm call bills full
price while Luna's drops 9× to $0.00007. Full numbers in
[hermes-brain.md](./hermes-brain.md) § 2026-09-11. It is not a Luna replacement anywhere.

The scoring defect this record originally exposed — live `ttft_ms` collected and never read —
is fixed, and has a successor guard: `metric_snapshot.conditions` now records the reasoning
setting each live measurement was taken under, and `normalizeMetrics()` drops speed metrics
captured with thinking suppressed rather than ranking them against default-effort numbers.

## 2026-09-12 (final): the measured fast-tier table

Two earlier passes on this page were wrong, both because of how the measurement was built
rather than how the models behave. `bun run bench:fast` now grades five deterministic tasks
across the full `reasoning_effort` ladder, 3 repeats, medians, `starved` counted separately
from `fail`, and **total wall time to a correct answer** as the headline. Report:
[`docs/experiments/fast-2026-09-12/report.md`](../experiments/fast-2026-09-12/report.md).

Best cell per model (15 calls each; `pass` = tasks whose repeats mostly passed):

| model | best effort | pass | median wall | decode | think spread | $/run |
|-|-|-|-|-|-|-|
| **gpt-5.6-luna** | `default` (=`medium`) | **5/5** | **1023ms** | 156 t/s | 335 | $0.00338 |
| **glm-5.3-flash** | **`low`** | **5/5** | 1802ms | 80 t/s | **48** | **$0.00125** |
| minimax-m3 | `medium` | 5/5 | 2114ms | 150 t/s | 7985 | $0.00782 |
| deepseek-v4.1-flash | `none` | 4/5 | 668ms | **658 t/s** | 7975 | $0.00534 |
| gemini-3.8-flash | `none` | 4/5 | 1758ms | 234 t/s | 1650 | $0.01983 |

**`gpt-5.6-luna` is the fastest model that clears every task**, and `glm-5.3-flash` at `low`
is the cheapest — 2.7× less, at +780ms. Those are the two picks.

### The effort setting decides more than the model does

`glm-5.3-flash`'s default effort is **`max`** (see
[reasoning-effort.md](./reasoning-effort.md)), and at `max` it **cannot produce a long
document at all**:

```
glm-5.3-flash  longform @ default (= max)   visible tokens: 0, 0, 0
glm-5.3-flash  longform @ low               visible tokens: 2111, 1972, 2136   3/3 pass
```

Eight thousand tokens of budget, entirely consumed by hidden reasoning, three times out of
three. Every glm-5.3-flash slot in the stack currently runs at that default because nobody
sets an effort. That is the single most actionable result of this benchmark.

### Where each model actually fails

Only the `longform` task (1000–1800 words, stated as a hard requirement in the prompt)
separates the field. Everything else is passed by everyone.

| model | longform behaviour | reading |
|-|-|-|
| `gpt-5.6-luna` | 2128 / 2159 / 2359 visible tokens | lands in range 2 of 3; overshoots slightly |
| `glm-5.3-flash` @ `low` | 2111 / 1972 / 2136 | **3 of 3 in range** |
| `gemini-3.8-flash` | 2863–3600, **6 of 6 over** | reproducibly ignores a stated word bound |
| `deepseek-v4.1-flash` | 644 / **0** / 218 / 828 / **0** / **0** | **cannot write a long document at an 8k budget** — thinking eats it |
| `minimax-m3` | 1947 / 359 / 2075, starves at `low` | erratic |

**Retraction, again, on `deepseek-v4.1-flash` — this time against it.** The previous pass had
it winning longform. With `starved` counted honestly it starves or truncates on **five of six**
long-generation attempts at an 8,000-token budget. Its 658 tok/s decode and 84-token crossover
are real, and it is genuinely the fastest to a *short* correct answer — but it cannot be
trusted to produce a long document unless the budget is very large. Its think spread is
~7,970 tokens across every cell, i.e. it reliably consumes whatever it is given.

**`gemini-3.8-flash`'s earlier 3/5 was mostly a defective grader** (an ambiguous German email
where `missing_item` and `damaged_item` were both correct; all 29 "failures" in the field were
that one answer). Corrected, it passes 4/5 at every effort. Its remaining miss is real and
reproducible: it overshoots an explicitly stated word range every single time. It is also
**$0.0198–0.0313 per run, 6–9× the field**, which remains the decisive argument against it.

### What this does not measure

Tool calling and multi-turn agent loops — which is what the Hermes brain, research-gateway's
workers and every sideclaw `session` tool actually are. Those are decided in
[gemini-tool-calling-shapes.md](./gemini-tool-calling-shapes.md) and by ccbench, not here. The
standing 3-tool number (luna 6.6s vs V4.1 21.4s) predates the budget-starvation finding and
should be re-run at ≥16k before it is trusted.
