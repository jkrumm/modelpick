# sideclaw's Five Tiers — Structural Picks, Not All Scored Ones

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
