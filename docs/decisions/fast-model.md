# Fast Model — DeepSeek-V4-Flash holds against GLM-5.2

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
