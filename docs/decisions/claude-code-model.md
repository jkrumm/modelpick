# Claude Code over the IU Anthropic Route — `claude-sonnet-5` interactive, `glm-5.3-flash` for workers

> **Current verdict (2026-09-13):** `claude-sonnet-5` interactive, `glm-5.3-flash` unattended
> worker, `claude-opus-5` EU-pinned. Only `claude-*`, `glm-5.3-flash` and `minimax-m3` are
> reachable on the Anthropic leg at all, so the candidate set is structurally closed.
> `MAX_THINKING_TOKENS` is the only reasoning-effort control that reaches `glm-5.3-flash` on
> this leg (unset defaults to its worst setting, uncapped `max`): worker/agentic lanes
> (agent-dispatch, sideclaw's AGENT tier, warden auto-dispatch) run **8192**; classify-shaped
> lanes (sideclaw's CLASSIFY tier — check/overview/review_router) run **2048**, the value
> measured on ccbench.
> **Status of this record:** current
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

**Decision (2026-08-31):** two picks, because interactive and unattended are different jobs and
one number does not cover both.

- **Interactive Claude Code** — `claude-sonnet-5`. Fastest in the field by a wide margin,
  perfect score, fewest turns. When a human is waiting, wall clock *is* the product.
- **Unattended workers** (sideclaw, `rd bg`, batch jobs) — `glm-5.3-flash`. Perfect score on all
  ten tasks, **32x cheaper** than `claude-sonnet-5`, and by ArtificialAnalysis's index the
  smarter of the two. The price is latency: 6.5x slower on ordinary work, up to 38x on heavy
  reasoning. Nobody is watching, so that is free money.
- **EU-pinned when you want it** — `claude-opus-5`, the only id in the field EU-resident under
  its bare name. The cheap tier is a Requesty hop to the vendor (`glm-5.3-flash` → `zai/`);
  since IU procured and serves those models itself, that is accepted here for work and personal
  code alike — recorded so the trade is visible, not to fence it off.

Note the split matches the mechanism: native subagents inherit their parent session's endpoint,
so a Max session cannot delegate to an IU model. Handing work to `glm-5.3-flash` from a Max
orchestrator only happens through the subprocess lanes (`rd bg`/`agent-dispatch`, `ca`/`cap`),
which run on IU credentials directly — never through sideclaw's `mcp__sideclaw__dispatch`,
which is pinned to Sonnet on Max (fallback IU) regardless of any worker-backend env var; see
`sideclaw/server/lib/routing.ts` for the live per-tool table, and
[sideclaw-tiers.md](./sideclaw-tiers.md) for why the other four tiers are routed the way
they are.

This supersedes the earlier LiteLLM-bridge lane (retired 2026-09-04), whose premises have both
expired.

## The finding that decides everything else

A hundred and thirty graded agent sessions, thirteen models, ten tasks. **Twelve of the thirteen
scored a flat 1.00 on every task they completed.**

Not "roughly comparable" — identical. `claude-haiku-4-5`, `minimax-m3`, `kimi-k2.7-code`,
`DeepSeek-V4-Flash` and `GLM-5.1` each matched `claude-opus-5` on a recursive-descent parser with
exact error offsets, an algorithmic complexity refactor under a timing budget, five independent
bugs across seven files, and a five-hop import trace through a hundred-file service with planted
decoys. The suite was rebuilt once, harder, specifically to break this. It did not break.

**So the quality column measures the wrong thing, and it is important to say so.** On
ArtificialAnalysis's intelligence index the same field spans **24.1 to 63.1** — `claude-haiku-4-5`
at 24.1 and `claude-opus-5` at 63.1 produced identical scorecards here. This suite measures
*can a model drive the Claude Code harness without falling over*, which is a real and separately
useful question, but it is not a capability ranking and must not be read as one. Where the two
disagree, the external index is the better evidence on intelligence and this suite is the better
evidence on harness fitness.

That leaves cost, wall clock and turn count as what actually varies — and one genuine surprise:
**Claude Code does not need a Claude model.** Five non-Claude ids drive the agent loop as well as
Opus 5 does. The gateway's Anthropic translation holds up completely: tool calls, parallel
batches, streaming, cache.

## External intelligence index (ArtificialAnalysis, 2026-08-31)

Collected by modelpick's own collector, alongside the measured columns rather than instead of
them.

| model | AA intelligence | AA coding | ccbench quality | ccbench cost |
|-|-|-|-|-|
| claude-opus-5 | 63.1 | 78.0 | 1.00 | $2.544 |
| claude-fable-5 | 62.1 | 76.5 | 1.00 | $4.460 |
| GLM-5.3 (flash variant ~58) | 59.5 | 74.8 | 1.00 | **$0.035** |
| claude-opus-4-8 | 57.3 | 74.3 | 1.00 | $1.733 |
| claude-sonnet-5 | 55.3 | 71.5 | 1.00 | $1.127 |
| DeepSeek-V4-Pro | 53.2 | 68.8 | 1.00 | $0.664 |
| DeepSeek-V4-Flash | 51.8 | 69.1 | 1.00 | $0.666 |
| minimax-m3 | 45.4 | 58.6 | 1.00 | $0.194 |
| kimi-k2.7-code | 43.0 | 60.8 | 1.00 | $0.307 |
| GLM-5.1 | 41.0 | 55.8 | 1.00 | $0.335 |
| claude-haiku-4-5 | 24.1 | — | 1.00 | $0.606 |

`glm-5.3-flash` sitting above `claude-sonnet-5` on the external index while costing 32x less is
what settles the worker pick. `minimax-m3` was an earlier draft's answer, chosen on wall clock
before this data was refreshed; at 45.4 it is the weakest of the cheap tier that AA rates, and
5.5x dearer than GLM.

## Bake-off — 13 models x 10 tasks, IU Anthropic route, 2026-08-31

Cost for Claude ids is Anthropic list pricing; for the rest it is **measured**, solved from the
gateway's own `usage.cost` field (see *Pricing the field* below). Quality and pass rate are
1.00 / 100% for every row except the two marked.

| model | composite | cost | wall | mean turns | tool err | notes |
|-|-|-|-|-|-|-|
| glm-5.3-flash | 0.81 | **$0.035** | 38m 24s | 10.1 | **0%** | scored 0.97 here — the 2 misses were the clock, not capability (below) |
| **claude-sonnet-5** | 0.80 | $1.127 | **5m 03s** | 8.7 | 3% | fastest, perfect |
| **minimax-m3** | 0.78 | $0.194 | 6m 51s | 12.6 | 3% | perfect, 5.8x cheaper than sonnet-5 |
| kimi-k2.7-code | 0.76 | $0.307 | 6m 51s | 12.1 | 6% | perfect |
| claude-opus-4-8 | 0.75 | $1.733 | 6m 46s | 8.5 | 4% | |
| claude-sonnet-4-6 | 0.72 | $1.256 | 8m 12s | 8.0 | 5% | US route |
| claude-opus-5 | 0.71 | $2.544 | 9m 43s | 9.8 | 1% | EU-pinned |
| GLM-5.1 | 0.70 | $0.335 | 11m 41s | 9.3 | 5% | perfect |
| claude-haiku-4-5 | 0.70 | $0.606 | 10m 28s | 11.3 | 9% | worst tool-error rate |
| DeepSeek-V4-Flash | 0.70 | $0.666 | 11m 04s | 12.3 | 4% | perfect |
| claude-fable-5 | 0.69 | $4.460 | 10m 24s | 8.5 | 4% | 128x the cost of glm-5.3-flash |
| DeepSeek-V4-Pro | 0.68 | $0.664 | 13m 22s | 11.1 | 2% | perfect |
| MiMo-V2.5-Pro | 0.44 | — | 61m 27s | 6.7 | 4% | 0.64 quality — collapsed, 7 of 10 runs died |

Composite is 50% quality, 20% cost, 20% speed, 10% tool fidelity, cost and speed normalised as
`best/value`. With quality flat across twelve rows it is effectively a cost-and-speed index,
which is the honest thing for it to be.

### Reading the table

**`claude-sonnet-5` wins interactive on wall clock and nothing else.** It is 35% faster than
`minimax-m3` and costs 5.8x more for the same score. That is worth paying when a human is
waiting on it; it is indefensible for a background job.

**Cheap models work harder for the same answer.** `minimax-m3` takes 12.6 turns to
`claude-sonnet-5`'s 8.7, `DeepSeek-V4-Flash` 12.3. More turns means more tokens, which is the
cost multiplier a raw $/MTok comparison hides — and they are *still* several times cheaper
after it.

**`claude-fable-5` is the clear loser.** $4.46 against `glm-5.3-flash`'s $0.035 — 128x — for
an identical scorecard, and it is not even the fastest. At $10/$50 per MTok it is priced above
Opus, and in an agent loop that compounds over every cached turn.

**`MiMo-V2.5-Pro` passed screening and then collapsed at full scale.** Two easy tasks looked
fine; across ten it died seven times on timeouts and API errors. Screening on small tasks is
not evidence a model survives real ones.

### The timeouts were a stopwatch, not a verdict

`glm-5.3-flash` hit the task timeout on `parser-spec` and `perf-refactor` and lost 0.03 of
quality for it. That was the harness's fault, not the model's — `parser-spec` had **already
scored 1.00 while timing out**, meaning it finished the work and was killed on the clock.

Re-run at a 4x budget, twice each:

| task | claude-sonnet-5 | glm-5.3-flash (retest) | score | ratio |
|-|-|-|-|-|
| parser-spec | 70s | 797s / 627s | 1.00, 1.00 | ~10x |
| perf-refactor | 63s | 2379s / 2278s | 1.00, 1.00 | ~38x |

Four runs, four perfect scores, no failures, **$0.085 total**. `glm-5.3-flash` solved the
O(n²)→O(n) refactor under its own timing budget correctly, twice, taking forty minutes each time.

So its real profile is: perfect quality, near-free, and very slow — and the slowdown is
task-shaped, worst on heavy reasoning. On the eight tasks both models completed inside the
normal budget the honest ratio is **1104s against 170s, 6.5x**. That is the number to plan
around, not the 38x worst case and not the timeout-inflated 38m24s total.

This is the single biggest design defect the suite shares with every published benchmark. A
task timeout folds model latency, tool execution and verification into one budget, so a
slow-but-correct model reads as a failure. Terminal-Bench and SWE-bench Pro do not separate
these clocks either, and CodeCrafters' own benchmark reports Gemini 3 Pro Preview exceeding
their 20-minute timeout on ~25% of tasks. `--timeout-scale` is the stopgap; separating the
agent, model-generation, tool and verifier clocks is the fix.

### Why `glm-5.3-flash` is slow, and what does not fix it

The first version of this doc reported "6.5x slower" from one sample per task. That number was
not safe to quote: re-running `parser-spec` three times gave **280s, 600s and 737s** for
identical, correct work. The spread was larger than the effect being claimed.

Chasing it produced a better answer. Measured in isolation, `glm-5.3-flash` generates at
**~42 tok/s** — consistent with Z.ai's published ~49, and roughly half the field's faster
models. But its *effective* rate inside the agent loop is far lower:

| model | output tokens | wall | effective tok/s |
|-|-|-|-|
| DeepSeek-V4-Flash | 76,713 | 664s | 115.6 |
| minimax-m3 | 42,857 | 411s | 104.2 |
| claude-sonnet-5 | 25,400 | 303s | 83.8 |
| kimi-k2.7-code | 16,285 | 411s | 39.6 |
| **glm-5.3-flash** | 30,708 | 2304s | **13.3** |

42 raw against 13.3 effective means roughly two-thirds of its wall clock is not generation — it
is per-turn round-trip overhead, and that multiplies by turn count rather than by task size.
Which is exactly why a single benchmark task looked tolerable and a long implementation brief
did not: a real four-item brief in another repo ran 90 minutes and produced nine tool calls and
zero lines of code before it was stopped.

**The effort dial does not exist on this route.** Community guidance for GLM-5.3-Flash on Z.ai's
direct endpoint reports a large lever — the same ten tasks taking 29 minutes at `max` effort
against 98 seconds at `low`, since the model always reasons and `reasoning_effort` defaults to
`max`. That lever is inert here. Probed against IU at five effort levels, output tokens came
back **low 7878, medium 2049, high 8313, max 6364** — no ordering — at a flat 36.8–45.7 tok/s.
`output_config.effort` does not survive the Requesty hop.

What *did* transfer from that guidance is the compaction window: compacting early rewrites
history and busts the prefix cache, re-paying full fresh-input price. That is the dominant cost
term in an agent loop, and the measured cache-hit spread across this field is wide — 89% for
`minimax-m3`, `kimi-k2.7-code` and `claude-sonnet-5`, against **16% for `DeepSeek-V4-Flash`**,
whose run cost 3.4x the MiniMax one despite a cheaper rate card. `ca`'s gateway tier now sets
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` to each model's real window.

The practical shape: GLM's latency is a **stable property, not noise, and it scales with turns**.
It is the right default where nobody is watching and wrong wherever turn count is high or a
human is waiting.

### Screened out before the main run

Twelve non-Claude ids were screened on two cheap tasks first. Five did not earn a full run:

| id | why |
|-|-|
| glm-5.2 | dead — 1 turn, api_error, every attempt |
| nemotron-3-ultra | dead — 1 turn, api_error, every attempt |
| hy3 | scored 0.00 on `batch-read` |
| NVIDIA-Nemotron-3-Super-120B-A12B | scored 0.71 on `batch-read` |
| qwen3.7-max | scored 0.00 on `locate`, and 4m 26s on two tasks |

## Pricing the field

The Claude Code CLI reports `total_cost_usd` with `costBasis: "list"`. For Claude ids that is
correct — solving it against its own token counts on four live runs lands exactly on Anthropic
list pricing. For every non-Claude id it is **fiction**: the CLI has never heard of
`DeepSeek-V4-Flash`, so it prices it at a Claude-tier default.

Repricing the screening suite against measured rates moved every affected row by 2.3x to 77x:

| model | CLI said | actually | factor |
|-|-|-|-|
| glm-5.3-flash | $0.093 | $0.001 | 77x over |
| hy3 | $0.053 | $0.001 | 36x over |
| DeepSeek-V4-Flash | $0.116 | $0.010 | 12x over |
| minimax-m3 | $0.074 | $0.008 | 9x over |
| kimi-k2.7-code | $0.050 | $0.008 | 6x over |
| MiMo-V2.5-Pro | $0.079 | $0.030 | 2.6x over |

So ccbench now computes cost from token counts against a real rate card — `pick_probe` rates
for non-Claude ids, a committed list-price table for Claude — and records which basis each row
used. A run that billed no tokens at all prices as **unpriced**, never as free: the ~190s
retry-storm failures bill nothing, and calling that $0 hands the best possible cost term to a
model that produced no work.

### Rate card (per MTok, measured from the gateway)

| model | in | out | cache read | real context |
|-|-|-|-|-|
| glm-5.3-flash | 0.075 | 0.25 | 0.015 | ~1.1M |
| hy3 | 0.14 | 0.58 | 0.035 | — |
| DeepSeek-V4-Flash | 0.44 | 1.32 | 0.014 | ~1.1M |
| minimax-m3 | 0.639 | 1.193 | 0.060 | ~1.1M |
| DeepSeek-V4-Pro | 0.66 | 1.98 | 0.044 | — |
| kimi-k2.7-code | 0.95 | 4.00 | 0.190 | 262K |
| GLM-5.1 | 1.40 | 4.40 | 0.260 | — |
| MiMo-V2.5-Pro | 2.32 | 2.97 | 0.200 | ~350K |

Anthropic list, for comparison: haiku-4-5 $1/$5 (200K), sonnet-5 $2/$10, sonnet-4-6 $3/$15,
opus-4-8 and opus-5 $5/$25, fable-5 $10/$50 (all 1M). Cache write is 1.25x input, cache read
0.1x.

`claude-sonnet-5` being both newer and cheaper than `claude-sonnet-4-6` is not a typo — it is
most of the argument for retiring 4.6 from this lane. And `glm-5.3-flash` at $0.075/$0.25 is
**13x below haiku on input and 20x below on output**, which is what a $0.035 suite run buys.

## Data residency — the part the catalog does not tell you

Every `/messages` response carries `x-middleware-forwarded-server` and
`x-middleware-forwarded-model`. The second is load-bearing: Bedrock inference profiles encode
their routing scope in the prefix, so `eu.` stays in the EU and `global.` may not. Nothing in
`GET /models` exposes this. `bun run route-map` surveys it for 8 output tokens per id.

| id | backend | upstream profile | residency |
|-|-|-|-|
| claude-opus-5 | AWS Bedrock eu-west-1 | `eu.anthropic.claude-opus-5` | **eu** |
| claude-sonnet-5 | AWS Bedrock eu-west-1 | `global.anthropic.claude-sonnet-5` | global |
| claude-opus-4-8 | AWS Bedrock eu-west-1 | `global.anthropic.claude-opus-4-8` | global |
| claude-opus-4-8-eu | AWS Bedrock eu-west-1 | `eu.anthropic.claude-opus-4-8` | eu |
| claude-haiku-4-5 | AWS Bedrock eu-west-1 | `global.anthropic.claude-haiku-4-5-…` | global |
| claude-haiku-4-5-eu | AWS Bedrock eu-west-1 | `eu.anthropic.claude-haiku-4-5-…` | eu |
| **claude-sonnet-4-6** | **Vertex IU Group useast-5** | `claude-sonnet-4-6` | **us** |
| claude-sonnet-4-6-eu | AWS Bedrock eu-west-1 | `eu.anthropic.claude-sonnet-4-6` | eu |
| claude-fable-5 | Azure Global Sink Sweden | `claude-fable-5` | eu |

Three things worth holding:

- **`claude-sonnet-4-6` is a US route.** The plain id lands on Vertex us-east. If anything
  personal or work-confidential goes through Claude Code, that id is the wrong door.
- **`claude-opus-5` is already EU-pinned** with no `-eu` alias to reach for. It is the only id
  in the field that is EU-resident under its bare name — which makes it the EU answer.
- **`claude-sonnet-5` is `global.`** — the one real cost of the pick.

Sampled five times per id: the backend is stable, not round-robined.

### The cheap tier has no residency story at all

Every non-Claude id on this route reports the same backend — `Requesty Global Anthropic API` —
and forwards to the original vendor, named in the upstream id:

| model | forwards to |
|-|-|
| minimax-m3 | `minimaxi/minimax-m3` |
| glm-5.3-flash | `zai/glm-5.3-flash` |
| GLM-5.1 | `zai/GLM-5.1` |
| kimi-k2.7-code | `moonshot/kimi-k2.7-code` |
| DeepSeek-V4-Flash / Pro | `deepseek/deepseek-v4-flash` / `-pro` |
| MiMo-V2.5-Pro | `deepinfra/XiaomiMiMo/MiMo-V2.5-Pro` |
| hy3 | `novita/tencent/hy3` |
| qwen3.7-max | `alibaba/qwen3.7-max` |

So the whole cheap tier — every model that beats Claude on price here — is a Requesty hop to a
first-party vendor endpoint, most of them Chinese (Z.ai, Moonshot, MiniMax, DeepSeek, Alibaba,
Tencent), the rest US inference brokers. "Global" is the gateway's own word for it, and the
route exposes nothing finer.

**This is recorded as a fact, not a restriction.** IU procured these models and serves them on
its own corporate gateway — the company has already made the processor decision, and code sent
to `glm-5.3-flash` reaches Z.ai through a route IU chose to offer. Owner call (2026-08-31): that
is accepted for work code as well as personal.

Where it still bites is the *personal* stack, and for a different reason: Hermes handles
calendar, health and email, and [hermes-brain.md](./hermes-brain.md) picked `gpt-5.6-luna` on
verified Azure Sweden Central residency precisely because the Requesty layer strips the headers
that check relies on. That reasoning is unchanged — this decision is about a coding agent
working on repositories, not about an agent holding personal data.

Two operational notes that outlive the residency question: the Requesty hop is also why these
ids report `unknown` to `capability_probe`'s residency check, and why `pick_probe` can derive
their real rates at all (only Requesty-proxied responses carry `usage.cost`).

### Two `-eu` aliases cannot run Claude Code at all

`claude-haiku-4-5-eu` and `claude-opus-4-8-eu` answer a plain `/messages` call in under a
second and score 200 on every reachability probe. They also fail **every** Claude Code session:
zero turns, ten retries, dead after ~190 seconds. Fifteen out of fifteen attempts across two
separate runs.

The cause, by bisection:

| request to `claude-opus-4-8-eu` | result |
|-|-|
| exact shape Claude Code sends | 503 x3 |
| same, minus `context_management` | **200 x3** |
| same, minus `thinking` + `effort` | 503 x3 |
| bare `{model, max_tokens, messages}` | 200 x3 |
| exact shape, to `claude-opus-4-8` (non-EU) | 200 x3 |

Claude Code sends `context_management: {edits: [{type: "clear_thinking_20251015"}]}` on every
single request — confirmed by proxying the CLI. These two `-eu` profiles reject it. The
gateway then surfaces that rejection as a **503 `server_error`** instead of the 400 it is, so
the CLI classifies it as retryable, exhausts all ten retries, and reports a server outage for
what is a request-shape rejection. Nothing in the transcript names `context_management`.

`claude-sonnet-4-6-eu` accepts it and works normally, so this is per-alias, not a property of
the `-eu` suffix.

Recorded as `CLAUDE_CODE_INCOMPATIBLE` in `src/server/bench/models.ts`. The general lesson is
worth more than the two ids: **a 200 from `/messages` is not evidence a model can run Claude
Code.** Only driving the real CLI finds this class of failure, which is most of the argument
for ccbench existing.

## EU twins, where they work

Three tasks x three repeats, 2026-08-31:

| model | quality | cost (list) | wall | verdict |
|-|-|-|-|-|
| claude-sonnet-4-6 | 1.00 | $0.762 | 8m 51s | works, US route |
| claude-sonnet-4-6-eu | 1.00 | $0.655 | 10m 17s | works, EU-pinned, no real penalty |
| claude-haiku-4-5 | 1.00 | $0.303 | 3m 44s | works |
| claude-haiku-4-5-eu | 0.08 | — | 30m 01s | **dead** — every session 503s |
| claude-opus-4-8 | 1.00 | $0.930 | 2m 29s | works |
| claude-opus-4-8-eu | 0.08 | — | 28m 21s | **dead** — every session 503s |

Where an EU twin works at all, residency is close to free: `claude-sonnet-4-6-eu` costs 14%
less than its US-routed parent and runs within noise of it. The `-eu` variance is wide though
— `claude-sonnet-4-6` swung from 9.2s to 231.4s on the same task across three attempts, which
is the strongest reason to leave the whole 4.6 line behind.

**So: `claude-sonnet-5` by default, `claude-opus-5` when the session must stay in the EU.**

## Gotchas the route hands you

- **Listed is not callable.** `claude-3-5-sonnet-latest`, `claude-3-7-sonnet-latest`,
  `claude-opus-4-0` and `claude-sonnet-4-0` are served by `GET /models` and return 503 on every
  call. Recorded in `DEAD_IDS` so nobody rediscovers them.
- **Every model reports a 200K context window.** The CLI cannot discover the real window
  through the gateway. For a Claude id (`claude-sonnet-5`) the fix is the `[1m]` model
  suffix, stripped before the id reaches the provider — never
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, which is `claude.zsh`'s fix for *gateway* ids only (a
  client-side compaction budget from `_CA_CTX`, not a capability claim; too high there is a
  hard API rejection mid-task, not a compaction).
- **`ANTHROPIC_API_KEY` must be unset, not empty.** claude v2.x rejects it with "Not logged
  in". `ANTHROPIC_AUTH_TOKEN` is the working door.
- **All four `ANTHROPIC_DEFAULT_*` tiers must pin to the same id**, or a spawned subagent asks
  the gateway for a `claude-*` default it does not serve and 400s.

## What changed since `ca`

The earlier LiteLLM-bridge lane (retired 2026-09-04) rejected real Claude over IU on two
grounds. Both are gone.

1. *"Defeats the cost-saving purpose."* It was arguing against Opus, and it was right to. But
   the field is not Opus-or-bridge: `minimax-m3` scores a perfect 10 for $0.194 and
   `glm-5.3-flash` for $0.035, both **on the native Anthropic route**. Cost is no longer a
   reason to leave it.
2. *"Broke usage-tracker billing classification."* Stale. `classifyBilling()` no longer keys on
   the model name for `claude-code` sources; it checks the session's recorded base URL
   (`getSessionBaseUrl`), so an IU-routed session books as `iu` regardless of the model id. The
   `-eu` suffix workaround is no longer load-bearing.

And the bridge's own pick is now measured rather than assumed: `DeepSeek-V4-Pro` scores a
perfect 10 here, but at $0.664 and 13m 22s it is the slowest and among the priciest of the
cheap tier — `minimax-m3` beats it on every axis at a third of the wall clock. So the bridge
costs an extra hop to reach a worse model than the route already serves directly.

That removes the reason the LiteLLM bridge existed in this lane.

## ccbench — how the numbers were made

`bun run bench` (`scripts/bench.ts`, `src/server/bench/`). Each run copies a committed fixture
into a throwaway sandbox, spawns a real `claude -p` session against the IU Anthropic route,
tees the stream-json transcript, parses it into metrics, and grades the resulting files
mechanically. Results land in `bench_run`.

Ten tasks over seven dimensions — `search`, `coding`, `multi_file`, `recovery`, `tool_use`,
`adherence`, `reasoning`. Six are small and mechanical; four are hard (`parser-spec`,
`perf-refactor`, `multi-bug`, `deep-search`). Graders are deterministic and offline: exit
codes, file bytes, transcript metrics. Nothing grades the model's prose about its own work,
because a model that confidently claims success is exactly what the suite exists to catch.

Three design choices carry the result:

- **Isolated `CLAUDE_CONFIG_DIR`.** Without it the operator's global CLAUDE.md, 3 MCP servers,
  44 extra tools and SessionStart hooks load into every sandbox — 71 tools and 35K
  cache-creation tokens against 27 and 20.5K with isolation. Skipping this measures your
  dotfiles, not the model.
- **Hidden tests.** Held out of the sandbox until the agent exits, so a model cannot write a
  test that asserts whatever it happened to implement.
- **Partial credit.** Every hard task splits into three or more independently-checkable pieces.
  A binary green/red on a hard task is a 0/1 cliff that wastes the run — `multi-bug` grades per
  test file, so fixing three of five scores 0.6.

### What the suite got wrong

`claude-sonnet-5` solved `batch-read` once with a single Bash loop — `for f in a b c d e f; do
cat notes/$f.md; done` — one tool call in 5.2 seconds where every other model issued six
parallel `Read`s. The check demanded a parallel batch of 3+, so the cheapest correct solution
in the whole run scored as a miss. The check now accepts either a 3-wide batch or a single
command covering all six; a model is only penalised for actually serialising the reads.

Worth stating plainly because it is the failure mode every benchmark has: the metric encoded
one good strategy and punished a better one.

Known limits: one repeat per cell in the main suite, so a single number is a signal rather than
a measurement — a separate three-repeat run found variance the single-repeat run hid, including
a `claude-opus-5` `locate` attempt that ran 240s into the task timeout. Runs execute at
concurrency 3, which inflates wall clock across models but not perfectly evenly, so treat the
wall-clock column as a ranking rather than a stopwatch. Task timeouts (240-600s) bound the
slowest models, so `glm-5.3-flash` and `MiMo-V2.5-Pro` are partly being graded on latency in
the quality column — deliberate, since a model that cannot finish inside ten minutes has failed
the task in any sense that matters, but worth naming. And the difficulty ceiling is clearly
below the field, which is the headline finding rather than a defect.

The graders are covered by committed golden-solution tests: every file-based task is asserted
to score 1.00 against a hand-written reference solution, and each has a negative control that
must land on a specific partial score. Without those, "every model scored 1.00" and "the grader
is broken" produce the same table.

## 2026-09-11: the AA index rescale moved `glm-5.3-flash` below the `coding` floor

ArtificialAnalysis recalibrated its intelligence index between the 2026-09-08 and 2026-09-09
collections. It is a rescale, not a reranking: the top of the field is unchanged in order
(`claude-fable-5-1` → `gpt-6-astra` → `claude-opus-5`) and every strong model lost 3–7 points
of absolute score (fable 56.8 → 53.4, Luna 43.4 → 37.5), while weak legacy models gained a few
(`gpt-4o-mini` 1.4 → 6.7). Mid-field ranks shuffle by ±3 places.

The consequence for this repo is a floor artifact, not a model change. `CATEGORY_MIN_QUALITY`
gates `coding` at 0.8 normalized quality, and normalization is min-max across the live field —
so compressing the bottom and lowering the top moved what 0.8 *means* from ≈AA 51 to ≈AA 44.
`glm-5.3-flash` sat at 0.810 before the rescale and 0.760 after, with no change to the model.
The recommender's `coding` pick flipped `glm-5.3-flash` → `glm-5.3` on 2026-09-09 purely
because of that crossing, and the eligible field for `coding` shrank to five models.

**So the `coding` drift flag on `/stack` is currently an artifact — twice over.** Beyond the
floor crossing, `glm-5.3` **404s on the IU Anthropic route** (verified 2026-09-11: the route
serves 36 ids, and the GLM entries are `GLM-5.1`, `glm-5.2` and `glm-5.3-flash`). It cannot
drive a Claude Code session at all, so it cannot be the worker pick whatever it scores. The
recommender has no notion of which route serves an id; `/stack` drift for `coding` therefore
needs the route check applied by hand until it does.

Among ids the Anthropic route actually serves, `glm-5.3-flash` also wins the leaderboard
comparison outright — AA coding index 71.5 at $0.15/$0.50 per MTok, against `DeepSeek-V4-Pro`
at 68.8 for $1.32/$3.96, `DeepSeek-V4-Flash` 69.1, `kimi-k2.7-code` 60.8, `minimax-m3` 58.6,
`GLM-5.1` 55.8. Re-derive the 0.8 floor against the new scale before treating a `coding`
recommendation as a signal again — and read the re-bench below before treating that
leaderboard row as the answer either.

## 2026-09-11 re-bench: the timeouts were the clock, and `glm-5.3-flash` holds

The 2026-08-31 verdict excused `glm-5.3-flash`'s two timeouts as "the clock, not capability".
A re-run of the four cheap Anthropic-route candidates (`--suite coding-2026-09-11`, full report
in [../experiments/ccbench/coding-2026-09-11/report.md](../experiments/ccbench/coding-2026-09-11/report.md))
appeared to overturn that — four timeouts out of ten and a failed `perf-refactor`:

| model | composite | quality | pass | suite cost | suite wall | mean turns | AA coding |
|-|-|-|-|-|-|-|-|
| `minimax-m3` | 0.82 | 1.00 | 10/10 | $0.164 | 5m 29s | 12.0 | 58.6 |
| `glm-5.3-flash` | 0.78 | 0.91 | 9/10 | **$0.016** | 40m 22s | 9.8 | **71.5** |
| `kimi-k2.7-code` | 0.72 | 1.00 | 10/10 | $0.354 | 9m 23s | 11.3 | 60.8 |
| `DeepSeek-V4-Pro` | 0.68 | 1.00 | 10/10 | $0.774 | 13m 36s | 12.5 | 68.8 |

**That reading was wrong, and the per-task rows say so.** Every timeout landed exactly on its
budget — 600/600/420/360s, the task's own `timeoutMs` — with blank `api_duration_ms` and zero
output tokens, because those rows are reconstructed from a partial transcript after the harness
SIGKILLed the session. The "stream ended without a result event" note *is* the kill. Three of
the four scored 1.00 anyway: the edits had landed before the clock fired. On the six tasks it
was allowed to finish, `glm-5.3-flash` averaged 73s against `minimax-m3`'s 33s — 2.2× slower,
not the 7× the suite-wall column implies, because most of that column is the harness's own
budgets being spent.

Re-run with `--timeout-scale 3` (`--suite glm-slowclock-2026-09-11`): **10/10, every task 1.00**,
including the `perf-refactor` that scored 0.11 at 1×. `implement-spec` and `house-rules`, both
killed at 1×, finished cleanly in 270s and 235s. The suite cost $0.048.

### `minimax-m3` was the wrong conclusion for a second reason

It aces ccbench and is the weakest model in the field everywhere else:

| eval | `glm-5.3-flash` | `DeepSeek-V4-Pro` | `minimax-m3` | `claude-sonnet-5` |
|-|-|-|-|-|
| AA coding index | **71.5** | 68.8 | 58.6 | — |
| DeepSWE (agentic SWE) | **0.634** | — | — | 0.538 |
| SWE-bench Verified | — | **0.776** | — | — |
| FrontierCode | — | 0.176 | 0.147 | 0.427 |
| LMCA | — | 0.412 | 0.337 | 0.493 |
| GPQA diamond | **0.902** | 0.896 | 0.813 | — |
| OTIS mock AIME | 0.939 | **0.967** | **0.267** | — |

That AIME row is the tell: `minimax-m3` is not a weak coder, it is a weak reasoner that drives
a tool loop reliably. ccbench cannot see the difference — it saturates, which is the documented
reason it is a gate and not a ranking. Picking on it alone selects for loop-hygiene and against
intelligence.

### The lever nobody had pulled: `glm-5.3-flash` defaults to max effort

Its model card documents `reasoning_effort` ∈ {low, high, max} with **max as the default**, and
Claude Code sends no effort hint. Measured against the IU Anthropic route, same prompt:

| request | 1st visible token | thinking | answer |
|-|-|-|-|
| plain (what ccbench sent) | 60,994ms | 17,837 chars | 2,235 chars |
| `thinking: {type: "disabled"}` | 51,031ms | 16,712 | 2,622 |
| `reasoning_effort: "low"` (passthrough) | 58,025ms | 20,491 | 3,088 |
| **`thinking: {enabled, budget_tokens: 512}`** | **2,089ms** | **58** | 2,393 |

**29×, same answer length.** Requesty ignores `reasoning_effort` and ignores
`thinking: disabled`; only an Anthropic-shaped thinking budget gets through — which Claude Code
exposes as `MAX_THINKING_TOKENS` (present in CLI 2.1.268). The 40-minute suite was max-effort
GLM under a ten-minute cap, a configuration no one in the field runs: Together measured Flash
on DeepSWE at 12.5s/step and 26min/task, a local bench measured the same ten tasks at 98s on
low effort against 1,735.8s on max, and Z.ai's own coding evaluations use six-hour task
timeouts.

### What the thinking cap is actually worth

Third run, `MAX_THINKING_TOKENS=2048` at the **normal** 1× clock
(`--suite glm-think2k-2026-09-11`):

| run | clock | thinking cap | tasks passed | timeouts | suite cost |
|-|-|-|-|-|-|
| `coding-2026-09-11` | 1× | none | 9/10 scored, 6/10 completed | **4** | $0.016 |
| `glm-slowclock-2026-09-11` | 3× | none | **10/10** | 1 (scored 1.00) | $0.048 |
| `glm-think2k-2026-09-11` | 1× | 2,048 | 9/10 | **1** | $0.033 |

On the six tasks that completed under every configuration, capping thinking cut wall-clock
~31% (441s → 303s). More usefully, three tasks that the 1× clock killed now finish inside it:
`implement-spec` 173s (budget 360), `house-rules` 318s (budget 420), `parser-spec` 551s
(budget 600). One repeat each, so read the per-task drops as consistent rather than isolated —
but they move in the same direction on all ten.

`perf-refactor` is the residue: still killed at 600s having taken only 3 turns, and it is the
one task that needed the 3× clock to pass. So **the cap is most of the fix, not all of it** —
the hard tier also needs a budget that reflects minutes-per-turn work. The Anthropic door
reports `thinking_tokens: 0` for every row regardless, so the cap cannot be confirmed from
usage accounting; the wall-clock drop is the only evidence it applied.

### Verdict

**`glm-5.3-flash` keeps the worker slot**, on the strength of 10/10 once the clock stops being
the experiment, the best coding index and DeepSWE score in the reachable field, and a suite
cost of $0.016–0.048 against `DeepSeek-V4-Pro`'s $0.774. One operational condition comes with it,
and it is the actual deliverable of this re-bench:

**Budget on idle, not wall clock.** A wall-clock kill cannot tell "still thinking" from
"wedged". It is a guess about how long work should take, and when the guess is wrong it
destroys the evidence that would have corrected it — the four "failures" above have blank
`api_duration_ms` and zero token counts precisely because the harness killed them. Claude Code
already exposes `CLAUDE_STREAM_IDLE_TIMEOUT_MS`, `API_TIMEOUT_MS` and `CLAUDE_CODE_MAX_RETRIES`;
ccbench and sideclaw both wrapped them in a fixed wall-clock kill. ccbench no longer does.

**The thinking cap is a dial, not a requirement.** `MAX_THINKING_TOKENS=2048` buys roughly 30%
wall-clock and is worth setting where latency is the product, but the model scores 10/10
*uncapped* once nothing kills it. Treating the cap as a precondition would have encoded a
workaround for a harness defect as a property of the model — which is how the `minimax-m3`
detour happened in the first place.

`DeepSeek-V4-Pro` remains the answer when wall clock is what you are paying for — 10/10 with
zero timeouts at 13m36s, SWE-bench Verified 0.776 — at 16–48× the cost per suite. `minimax-m3`
is a fast, reliable, *unintelligent* worker: fine for mechanical loops, wrong as the coding pick.

Residency is unchanged and absent for all four: every one is a Requesty hop reporting `global`.
Non-sensitive code only.

## 2026-09-12: `glm-5.3` vs `glm-5.3-flash` — Flash is not the small version, it is the agentic version

The recommender prefers `glm-5.3` for the `coding` category, which flagged seven worker slots
as drift. The pick does not move, and the reason is that "Flash" is misleading here: these are
**two separately trained models**, not one checkpoint at two sizes.

| | `glm-5.3` | `glm-5.3-flash` |
|-|-|-|
| Parameters | 744B total / 40B active | 320B total / 18B active |
| Lineage | post-trained from the GLM-5.2 base | **a new base**, not a distillation of 5.3 |
| Attention | DeepSeek Sparse Attention | hybrid sparse + linear, mHC, IndexPool |
| vs 5.3 | — | ~3.01× less attention compute, 4.44× smaller KV cache |
| Context | 1M | 1M |
| Thinking | forced on, `reasoning_effort` low/high/max | forced on, same |
| Multimodal | no | **yes** — first natively multimodal in the GLM-5 line |
| Price in / cached / out | $1.40 / $0.26 / $4.40 | **$0.15 / $0.03 / $0.50** |

Measured on our own data: quality 44.9 vs 41.9, coding index 74.8 vs 71.5, throughput 54.8 vs
**108.2 tok/s**, `latency_p50` 3.57s vs **2.04s**. So the larger model buys 3 points of index
for **9× the input price, 8.8× the output price, half the decode rate and 1.75× the latency**.

Two things settle it beyond the arithmetic:

1. **Z.ai positions Flash specifically for agentic/tool-calling coding** — ZCode, Browser Use,
   Computer Use, and a model card evaluated on DeepSWE, NL2Repo, Terminal-Bench and HLE-with-tools.
   It is the model built for the loop we run it in; `glm-5.3` is the bigger generalist.
2. **ccbench has run `glm-5.3-flash` 46 times for an average score of 0.966. `glm-5.3` has
   never been run at all.** The recommendation is a leaderboard extrapolation; the pick is a
   measurement.

The seven worker slots are therefore marked `follows_recommendation: false` — the `coding`
weight profile is quality-led (0.5 / 0.35 / 0.15) and the unattended-worker role is cost- and
throughput-led. ccbench's worker verdict governs them, not the category score.

Re-open if ccbench ever runs `glm-5.3` and it beats Flash on graded tasks, or if Flash's
forced-thinking (it cannot be disabled on either model) starts costing more in latency than
the price gap is worth.
