# sideclaw's Five Tiers — Structural Picks, Not All Scored Ones

> **Current verdict (2026-09-13):** six tiers now: `dispatch` split off CLASSIFY into its own
> **AGENT** tier (`glm-5.3-flash`, `thinkingTokens: 8192`) — an agentic episode needs more room
> than a classify-shaped call but must not default to GLM's unbounded `max`. CLASSIFY
> (`check`/`overview`/`review_router`) stays `glm-5.3-flash` at `thinkingTokens: 2048`. JUDGE
> (`review`, `otel`) and PROSE (`narrative`, `excalidraw`) both still run `claude-sonnet-5` on
> opposite billing lanes; VISION is `gemini-3.5-flash`; the adversary still runs `gpt-5.6-terra`.
> `SIDECLAW_THINKING_TOKENS_<TOOL>` overrides any tier's budget per tool.
> **Status of this record:** the table below still shows `dispatch` grouped under JUDGE — it now
> runs on its own AGENT tier at the cheap IU rate, not on Max.
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

sideclaw's per-tool routing table (`sideclaw/server/lib/routing.ts`) assigns every worker
route to one of five named tiers. Two of the five — CLASSIFY and VISION — are this repo's
own scored picks (`coding` and `vision` in [`seed.ts`](../../src/db/seed.ts)). The other
three — JUDGE, PROSE, and the adversary — are structural choices: nothing in this repo's
leaderboards scores "judgment work", "editorial prose", or "a second model family
disagreeing on purpose", so their rationale lives here instead of in a scored category.

| Tier | Model | Backend | Routes | Why |
|-|-|-|-|-|
| CLASSIFY | `glm-5.3-flash` (fallback `claude-haiku-4-5` on max) | iu | `check`, `overview`, `review_router` | This repo's `coding` pick — see [claude-code-model.md](./claude-code-model.md). Cheap, mechanical, unattended. |
| JUDGE | `claude-sonnet-5[1m]` (fallback iu) | max | `review`, `dispatch`, `otel` | Judgment work stays on the interactive-grade model, paid in Max quota rather than tokens, because a wrong verdict here (a merged PR, a dispatched episode) costs more than the quota it spends. |
| PROSE | `claude-sonnet-5[1m]` (fallback max) | iu | `narrative`, `excalidraw` | Editorial/generative output, but unattended volume — same model as JUDGE, opposite billing lane, because nobody is waiting on it and it should not spend Max quota to write prose. |
| VISION | `gemini-3.5-flash` | iu | `read_image`, `read_drawing` | This repo's `vision` pick — see [vision-and-image.md](./vision-and-image.md). |
| adversary | `gpt-5.6-terra` | iu-openai | `review`'s adversary pass | Deliberately out-of-family: a second model family disagrees differently than a same-family second opinion would, which is the point of running an adversary pass at all. |

Fallback is reactive and one hop only (never a pre-emptive quota check — removed
2026-09-08, see `sideclaw/CLAUDE.md`): a `max` attempt that fails before producing output on
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
