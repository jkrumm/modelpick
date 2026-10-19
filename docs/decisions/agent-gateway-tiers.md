# agent-gateway's Five Tiers — Structural Picks, Not All Scored Ones

> **Current verdict (2026-10-05):** the tier structure holds; the GLM ids named below are
> history — GLM retired from routing 2026-09-23. `dispatch` has its own **AGENT** tier (an
> agentic episode needs more room than a classify-shaped call) and runs OpenCode; CLASSIFY
> (`check`/`overview`/`review_router`) was re-pointed to `DeepSeek-V4-Flash` (see the note at the
> end). Current ids: agent-gateway `GET /api/routing`. JUDGE
> (`review`, `otel`) and PROSE (`narrative`, `excalidraw`) both still run `claude-sonnet-5` on
> opposite billing lanes; VISION is `gemini-3.5-flash`; the adversary still runs `gpt-5.6-terra`.
> `AGENT_GATEWAY_THINKING_TOKENS_<TOOL>` overrides any tier's budget per tool.
> **Status of this record:** the table below still shows `dispatch` grouped under JUDGE — it now
> runs on its own AGENT tier at the cheap IU rate, not on Max.
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

agent-gateway's per-tool routing table (`agent-gateway/server/lib/routing.ts`) assigns every worker
route to one of five named tiers. Two of the five — CLASSIFY and VISION — are this repo's
own scored picks (`coding` and `vision` in [`seed.ts`](../../src/db/seed.ts)). The other
three — JUDGE, PROSE, and the adversary — are structural choices: nothing in this repo's
leaderboards scores "judgment work", "editorial prose", or "a second model family
disagreeing on purpose", so their rationale lives here instead of in a scored category.

| Tier | Model | Backend | Routes | Why |
|-|-|-|-|-|
| CLASSIFY | `glm-5.3-flash` *(re-pointed to `DeepSeek-V4-Flash` 2026-09-23)* (fallback `claude-haiku-4-5` on max) | iu | `check`, `overview`, `review_router` | This repo's `coding` pick — see [claude-code-model.md](./claude-code-model.md). Cheap, mechanical, unattended. |
| JUDGE | `claude-sonnet-5[1m]` (fallback iu) | max | `review`, `dispatch`, `otel` | Judgment work stays on the interactive-grade model, paid in Max quota rather than tokens, because a wrong verdict here (a merged PR, a dispatched episode) costs more than the quota it spends. |
| PROSE | `claude-sonnet-5[1m]` (fallback max) | iu | `narrative`, `excalidraw` | Editorial/generative output, but unattended volume — same model as JUDGE, opposite billing lane, because nobody is waiting on it and it should not spend Max quota to write prose. |
| VISION | `gemini-3.5-flash` | iu | `read_image`, `read_drawing` | This repo's `vision` pick — see [vision-and-image.md](./vision-and-image.md). |
| adversary | `gpt-5.6-terra` | iu-openai | `review`'s adversary pass | Deliberately out-of-family: a second model family disagrees differently than a same-family second opinion would, which is the point of running an adversary pass at all. |

Fallback is reactive and one hop only (never a pre-emptive quota check — removed
2026-09-08, see `agent-gateway/CLAUDE.md`): a `max` attempt that fails before producing output on
a quota-flavoured signal retries once on `iu`; an `iu` attempt that fails on a transport
error retries once on `max`. Neither JUDGE nor PROSE nor the adversary is a leaderboard
entry in this repo's `stackChoice` table — they are recorded here because the reasoning is
real and repeatable, just not benchmarked.

Full picture, including the two Max-billing lanes and the warden/Hermes callers: brain
`wiki/engineering/model-routing.md`.

## 2026-09-24 — dispatch/dispatch_implement move off `claude -p` onto OpenCode

`dispatch` (investigate/author) and `dispatch_implement` no longer run the AGENT tier
(`DeepSeek-V4-Flash` via `claude -p` over the IU native Anthropic transport). Both now run a
new harness, OpenCode (`opencode run --format json`), on `deepseek-v4.1-flash` over the IU
endpoint's OpenAI-compatible route — a different id and a different transport `claude -p`
cannot reach at all. New tiers `AGENT_OC` (dispatch, `variant: "high"`) and
`AGENT_OC_IMPLEMENT` (dispatch_implement, `variant: "max"`) replace AGENT and the short-lived
AGENT_IMPLEMENT (DeepSeek-V4-Pro, retired the same day it was measured). Fallback stays
`claude-sonnet-5[1m]` on Max, always via the `claude` harness — a fallback attempt can never
run OpenCode.

Evidence: three implement briefs re-run from AGENT_IMPLEMENT's (DeepSeek-V4-Pro's) base
commits — vps $2.46/10min (Pro) vs $0.06/5min (OpenCode); research-gateway #21 $11.01/28min
vs $0.10/5min (max effort $0.11); weatherorb $5.39/21min vs $0.06/5min. A blind diff review
preferred OpenCode on 2 of 3 (research-gateway: the max-effort variant closed a gap Pro's
diff left open, 479/0 tests; weatherorb: tied on logic plus a doc update Pro skipped) and lost
one (vps: inverted volume-floor logic in a HyperDX config — recorded honestly, not a clean
sweep). Cache hits 95-98% on the OpenCode/OpenAI-route path vs 8% for Pro on the Anthropic
route (2026-09-23 spend: $69.69, 97% uncached input).

Also corrects a standing claim: prompt caching **does** work on the IU OpenAI-compatible
route for `deepseek-v4.1-flash` as of this date — a direct probe re-sending a 7780-token
prefix got `cached_tokens: 7552`, cost per call falling from $0.0011682 to $0.000058
(gateway-measured rates: $0.15/MTok input, $0.60 output, ~$0.003 cache read). The
`fast`-category no-caching claim in `seed.ts` and the hermes/brain row in `deployments.ts`
(both measured 2026-09-12) are corrected in place, dated, not deleted — the capability-over-
cost verdicts they fed stand unchanged; only the caching reading was wrong.

CLASSIFY (`check`/`overview`/`review_router`) is unaffected by this move but was itself
re-pointed 2026-09-23 from `glm-5.3-flash` to `DeepSeek-V4-Flash` when GLM retired from this
server entirely — recorded here since the table above still names the old model.

## 2026-10-19 — DeepSeek V4.1 Flash 1017 re-bench: Haiku 5.5 EU stays on the OpenCode routes

`deepseek-v4.1-flash` on IU forwards through Requesty to DeepSeek's first-party unversioned
id, whose Requesty entry was updated on 2026-10-17 in the same minute the `-1017` snapshot
appeared — so the IU id now serves 1017 with no id change. Dated ids (`…-1017`) are not on
the IU allowlist (404); the `-eu` variants route to Lyceum, which has not moved.

Re-ran agent-gateway's `scripts/bench-routes.ts` (OpenCode, production path, 2 reps) against
the Wave 5 field. Evidence: `docs/experiments/routes-2026-10-19/summary.md`.

| model | implement | investigate | review | median s (impl / review) | mean turns (review) | mean cost (review) |
|-|-|-|-|-|-|-|
| deepseek-v4.1-flash (1017) | 6/6 | 6/6 | 12/12 | 43 / 97 | 15.1 | $0.0218 |
| claude-haiku-5-5-eu | 6/6 | 6/6 | 12/12 | 29 / 21 | 3.3 | $0.0103 |

1017 closed the pass gap (Wave 5: 10/12 vs 12/12) but not the speed gap: it takes 2-5x the
turns. It has no price edge either — Haiku 5.5 lists at $0.10/$0.50 per MTok (cache read $0.01,
5x above 100K prompt tokens; agent-gateway's registry, matching Requesty's bedrock rate) vs
DeepSeek's $0.30/$1.20 — so implement costs the same and review costs twice as much. Haiku 5.5 EU
reaches Bedrock EU through IU's own LiteLLM, not Requesty, and returns no `usage.cost`. Review hint recall is level (17/24 vs 16/24). **No move.** dispatch,
dispatch_implement, check, overview, review and the four angles stay on Haiku 5.5 EU; warden
inherits them. 1017 is now a credible same-harness fallback, and stays the pick on the
single-shot routes (triage, review_router, prose_review, review_ocr) where turn count is 1.
Hermes brain is unaffected — it is a latency job and `bench:fast`
(`docs/experiments/fast-2026-10-19/`) shows no TTFT advantage for 1017.

### 2026-10-19 (later) — real-review replay confirms it

The bench-routes tasks were too easy to separate the two (24/24 each), so the question was re-run
on real work: 30 of the 111 frozen agent-gateway reviews (2026-10-18/19, mostly argo), replayed
through the live pipeline once per arm under the new verdict calibration (agent-gateway d3c86a1).
Only angles + synthesis vary; router, OCR and adversary stay on their routes. 23 items finished
in both arms (7 failed identically: their IuRoot worktrees no longer exist). Blocking findings
were judged blind by `gpt-6.1-sol` (cross-lab to both arms) against the frozen diff —
`bun run bench:review-judge`; the corpus and results stay local (they contain work diffs).

| arm | clean | blocking | confirmed | false blocking | unverifiable | p50 / p90 | angle+synthesis cost / review |
|-|-|-|-|-|-|-|-|
| Haiku 5.5 EU (no effort set) | 52% | 16 | 12 | 1 | 3 | 3.4 / 5.3 min | $0.020 |
| deepseek-v4.1-flash 1017 (high) | 57% | 17 | 10 | 1 | 6 | 5.5 / 10.0 min | $0.060 |

Both arms caught a confirmed blocker on exactly the same items — neither found a real defect the
other missed. Quality is a tie at this n (12 items with blocking findings); Haiku is ~1.6x faster
at p50, ~2x at p90, and a third of the cost (DeepSeek at peak rate; off-peak would halve it, still
1.5x). Cost is matched from usage-tracker's session sink by project/model/time window, which can
only over-count the Haiku arm (live reviews run Haiku), so the gap is if anything larger.
**Haiku 5.5 EU stays on review, dispatch and warden.** Re-open when ArtificialAnalysis or a new
snapshot moves the quality gap, not on price.
