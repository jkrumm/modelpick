# modelpick — collector and benchmark internals

*Moved out of `AGENTS.md` to keep it dense. The one-line rules stay there; this is
the how and why behind the Epoch AI collector and the ccbench harness.*

## Epoch AI benchmark collector

`src/server/collectors/epoch.ts` pulls Epoch AI's public benchmark export
(`https://epoch.ai/data/benchmark_data.zip` — no key, no auth) and is the only
source here that links back to real Inspect-AI eval transcripts rather than
reprinting a vendor's own claim. It covers benchmarks AA has no column for at
all: `swe_bench_verified`, `arc_agi`/`arc_agi_2`, `frontiermath`,
`aider_polyglot`, and more. **Licensed CC-BY 4.0 — attribution to Epoch AI is a
licence condition**, carried in the collector's header comment and in the
generated snapshot; don't strip it if this data moves anywhere else.

`benchmark_metadata.csv` (unzipped) drives everything: it names each
benchmark's `source_file` and `score_column`, so no column is ever hardcoded
per-file. Two things this source needs that the others don't:

- **Reasoning-effort suffixes.** Epoch appends
  `_none/_unknown/_low/_medium/_high/_xhigh/_max` to `Model version` for every
  model it re-ran across effort settings, giving one model several rows per
  benchmark. `stripEffortSuffix()` keeps exactly one row per model per
  benchmark — the *highest* available tier, since that's what a headline
  leaderboard number means once tiers exist. Matched on a literal underscore
  only (`glm-5.2_max` strips; `qwen3.7-max`, a real model name, does not).
- **Scale normalization.** Raw scores are on whatever scale the benchmark uses
  (e.g. percentages); `scale` from the index normalizes every value onto the
  same 0–1 range as `random_baseline`/`score_ceiling` before it's stored.

The committed snapshot `src/server/collectors/epoch-benchmarks.ts` (regenerated
wholesale on every `bun run collect`, same relationship as `iu-catalog.ts` ↔
`import-portal.ts`) captures per-benchmark
`random_baseline`/`score_ceiling`/`in_eci`/`release_date`/`superseded_by` and
exports `benchmarkSaturation()` — given a benchmark and its observed scores,
reports what share of the field sits near the ceiling, i.e. whether the
benchmark stopped discriminating between models (the ccbench-field-bunching
problem, but data-driven instead of eyeballed).

## ccbench internals — things that bite

`bun run bench` (`scripts/bench.ts`, `src/server/bench/`) copies a committed
fixture into a throwaway sandbox, spawns `claude -p` against the IU
**Anthropic** route with the model pinned on all four `ANTHROPIC_DEFAULT_*`
tiers, parses the stream-json transcript into metrics, and grades the
resulting files mechanically. Rows land in `bench_run`.

- **It spends real money.** `--yes` is required non-interactively, mirroring
  `pick`. `--dry-run` exercises the whole pipeline against a synthetic
  transcript and costs nothing.
- **Never remove the isolated `CLAUDE_CONFIG_DIR`.** Without it the global
  CLAUDE.md, MCP servers, extra tools and hooks load into every sandbox (71
  tools / 35k cache-creation tokens vs 27 / 20.5k) and the run measures
  dotfiles instead of the model.
- **Parallel tool use is detected by grouping assistant events on
  `message.id`** — the CLI emits one content block per event, so counting per
  event always yields 1. The `usage` object repeats identically across those
  events; totals must come from the `result` event or they multiply.
- **The CLI's cost figure is only valid for Claude ids.** For everything else
  it applies a Claude-tier default (over by up to 77x). `src/server/bench/cost.ts`
  re-prices from token counts against `pick_probe` rates; `--reprice` backfills
  stored rows. A zero-token run is `unpriced`, never free.
- **Graders are guarded by golden-solution tests.** Every file-based task
  asserts 1.00 against a committed reference under
  `fixtures/bench/<task>/.solution/`, plus a negative control. A
  silently-broken grader and a genuinely perfect field produce the same table
  without them.
- `bun run route-map` surveys where each id physically lands, from the
  gateway's `x-middleware-forwarded-*` headers — the only place residency is
  visible.

## Why a model looks slower on IU than on the leaderboard (2026-09-11)

Short answer: it mostly isn't. Measured decode rates on IU match or beat ArtificialAnalysis
for every model checked except one. What differs is **how much the model thinks before it
answers**, and **what each side calls "time to first token"**.

### The definitions do not line up

AA's performance methodology defines TTFT as request → **first response token**, and for a
reasoning model that is the *first reasoning token*. It publishes a separate **Time to First
Answer Token** that includes the thinking interval. Output speed is a decode rate measured
*after* the first chunk — and for models that do not expose all reasoning tokens, AA computes
it over the last 80% of answer chunks. Numbers are P50 over 72h, 1,000-token input workload,
standardized `o200k_base` tokens, measured from GCP `us-central1-a`.

This repo's `ttft_ms` is time to the first **visible** token — AA's *answer*-token metric, not
its TTFT column. Comparing the two reads as "IU is 10× slower" when the models agree.

### What the streams actually do

Same prompt (~250 words on TCP congestion control), IU `/openai/v1`, streamed, one pass:

| model | 1st SSE frame | 1st visible token | done | completion (of which thinking) |
|-|-|-|-|-|
| `gpt-5.6-luna` | 1,329ms | 1,337ms | 4.3s | 458 (65) |
| `deepseek-v4.1-flash` | **549ms** | 3,038ms | 5.4s | 629 (314) |
| `DeepSeek-V4-Flash` | 830ms | 10,788ms | 11.9s | 2,775 (2,415) |
| `glm-5.3-flash` | 1,793ms | 11,273ms | 14.1s | 1,383 (977) |
| `glm-5.3` | 2,766ms | 17,227ms | 19.0s | 1,622 (1,273) |
| `DeepSeek-V4-Pro` | 636ms | 5,359ms | 11.6s | 573 (199) |
| `gemini-3.8-flash` | 5,406ms | 5,406ms | 6.6s | 384 visible + 1,078 hidden |

**There is no proxy buffering on the Requesty path.** `deepseek-v4.1-flash` puts its first
frame on the wire in 549ms — faster than Luna — and streams reasoning deltas continuously from
there. The 3s wait for visible text is the model thinking out loud, not the gateway holding
bytes. `DeepSeek-V4-Flash` spends 2,415 of its 2,775 tokens thinking; that, and only that, is
why it takes 11.9s.

Decode rate, computed as completion tokens over the window from the first frame:

| model | AA median tok/s | measured on IU |
|-|-|-|
| `gpt-5.6-luna` | 126 | 154 |
| `DeepSeek-V4-Flash` | 239 | 251 |
| `glm-5.3-flash` | 92 | 112 |
| `glm-5.3` | 53 | 100 |
| `gemini-3.8-flash` | 331 | 319–397 |
| `DeepSeek-V4-Pro` | 70 | 52 |
| `deepseek-v4.1-flash` | 267 | **129** |

Only `deepseek-v4.1-flash` is materially under its leaderboard number, and that is a *serving*
difference, not an IU one: the response body names its upstream as
`accounts/fireworks/models/deepseek-v4p1-flash`, i.e. Fireworks' shared serverless tier, whose
own published figure is "up to 90–130 tok/s" with the caveat that load changes it. AA measures
whichever endpoint it tests; the same open-weight model runs at different rates at different
hosts, which is the whole point of AA's provider leaderboard.

### Gemini streams nothing before the answer

`gemini-3.8-flash` delivers its whole answer in ~16 SSE frames with the first at ~5.3s, on
**both** IU doors (`/openai/v1` and native `/gemini/v1beta`) — Google does not emit thought
parts unless `includeThoughts` is set, so the thinking interval is simply invisible. Its
visible decode rate (319–397 tok/s) matches AA's 331 almost exactly. The intended external
control (AI Studio, per [decisions/iu-vs-ai-studio.md](./decisions/iu-vs-ai-studio.md))
returned 503 "high demand" on both passes, so there is no third-party comparison for this
model today.

Its token accounting is also the odd one out: `prompt 17 + completion 384` against
`total 1479` — 1,078 thinking tokens that appear in the total and nowhere else.

### The instrument was lying too

Both live benchmarks computed throughput as *all* completion tokens (reasoning included)
divided by the visible-decode window (reasoning excluded). That produced `DeepSeek-V4-Flash
1160 tok/s` and `glm-5.3-flash 1045 tok/s` — artifacts, roughly 4–10× the real rate. The same
code added `reasoning_tokens` on top of `completion_tokens` when pricing a turn, double-billing
thinking on every OpenAI-shaped route (measured: `completion_tokens` already includes
`reasoning_tokens` on Azure OpenAI *and* Requesty ids; only the Gemini-over-OpenAI shape hides
them in `total_tokens`). Both were fixed on 2026-09-11, and `ttfb_ms` (first SSE frame) is now
recorded alongside `ttft_ms` so transport latency and thinking time can never be conflated
again.

### What this means for picking a model

**Thinking is not overhead — it is the quality lever.** AA's own ladder for one model, same
weights and same price per token throughout:

| `gpt-5.6-luna` at | non-reasoning | low | medium | high | xhigh | max |
|-|-|-|-|-|-|-|
| AA intelligence | 16.8 | 21.8 | 25.8 | 32.4 | 34.8 | **37.5** |
| AA coding index | 39.3 | 44.2 | 50.7 | 63.3 | 68.6 | **71.4** |

A model run at `reasoning_effort: none` is a **different and much weaker model** than the row
you picked it from. Every headline leaderboard number in this repo is the max-effort row.

So the question is never "does it think too much", it is **who decides how much**. Measured
2026-09-11, same hard debugging prompt, `max_completion_tokens: 4000`:

| config | 1st visible token | wall | thinking | visible |
|-|-|-|-|-|
| Luna, default | 14,227ms | 17.9s | 1,396 tok | 488 tok |
| Luna, `none` | **795ms** | 4.9s | 0 | 428 tok |
| Luna, `low` | 3,991ms | 7.9s | 321 tok | 472 tok |
| Luna, `medium` | 5,781ms | 9.9s | 512 tok | 522 tok |
| Luna, `high` / `xhigh` | — | 34.5s | **4,000 (cap)** | **0** |
| `deepseek-v4.1-flash`, default | — | 38.9s | **4,000 (cap)** | **0** |
| `deepseek-v4.1-flash`, `none` | 34,919ms | 38.2s | **3,267** | 473 tok |

Three things fall out of that table:

1. **Luna's default effort is adaptive**, and correctly so — 3 thinking tokens on the easy
   250-word explainer above, 1,396 on this one. That is the behaviour you want by default;
   forcing `none` to win a latency benchmark throws away most of the model.
2. **`deepseek-v4.1-flash` ignores the dial.** `reasoning_effort: none` still produced 3,267
   thinking tokens and took 35s to the first word; at default effort it spent the entire
   4,000-token budget thinking and returned **no answer at all**. The parameter is accepted
   (HTTP 200) and not honoured — that is the real objection to it, not the thinking itself.
3. **`high`/`xhigh` need a bigger budget than 4,000**, on any model here: thinking bills
   against `max_completion_tokens`, so a high-effort run under a small cap returns an empty
   completion that is indistinguishable from a failure. Same trap as the bake-off's Gemini
   note and the 600-token cap that used to sit in `benchmark-throughput.ts`.
