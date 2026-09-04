# Coding Model — DeepSeek-V4-Pro → DeepSeek-V4-Flash

**Current:** `DeepSeek-V4-Flash` since 2026-08-02, replacing `DeepSeek-V4-Pro` (held since
2026-06-02). The same `-0731` re-post-training that took the Hermes brain
([hermes-brain.md](./hermes-brain.md)) also flipped the coding case, and by a wider margin
than the general intelligence index did.

This is the pick behind `ca` (IU unified endpoint, native Anthropic route — see
[claude-code-model.md](./claude-code-model.md) for the interactive default that superseded the
retired local LiteLLM bridge) and sideclaw's `iu` worker backend — both **agentic coding
harnesses**, which is what the decision turns on.

## The asymmetry that decides it

DeepSeek never updated Pro. The 0731 changelog is explicit: *"This update only upgrades the
DeepSeek-V4-Flash API. The DeepSeek-V4-Pro API and the APP/WEB models are unchanged. The
official release of DeepSeek-V4-Pro will follow soon."* Pro is still the April 24 preview
build. Flash has had a full re-post-training since.

## Benchmarks

Coding index and general index, before and after:

| | Flash | Pro |
|-|-|-|
| AA Coding Index (2026-08-02) | **69.1** | 59.4 |
| AA Coding Index (2026-07-11, pre-0731) | 56.2 | 59.4 |
| AA Intelligence Index (2026-08-02) | **49.9** | 44.3 |

The 2026-08-02 row came from research first and from the ArtificialAnalysis API second — the
collectors were unblocked the same day (see Open, item 1) and `metric_snapshot` now carries
these numbers first-party.

Flash gained ~13 points on coding while Pro stood still — a 10-point inversion, wider than
the 6-point general-index gap that decided the Hermes brain.

Agentic coding, from the Flash-0731 model card (Pro column is the Preview build):

| | Flash-0731 | Pro |
|-|-|-|
| Terminal-Bench 2.1 | **82.7** (AA independent: 79) | 72.1 |
| DeepSWE | **54.4** | 12.8 |
| NL2Repo | **54.2** | 38.5 |
| DSBench-FullStack | **68.7** | 41.8 |

Live against IU, measured 2026-08-02 with `bun run benchmark` (3-turn prose scenario, both
aliases callable):

| | Flash | Pro |
|-|-|-|
| TTFT, avg over 3 turns | **2.6s** | 6.8s |
| Decode throughput | **124 tok/s** | 104 tok/s |

Price is unchanged since the April launch and unaffected by 0731: Flash $0.14 / $0.28 per 1M
in/out against Pro's $0.435 / $0.87. Both carry 1M context, 384K max output.

## Where Pro still wins

- **LiveCodeBench 93.5 vs 91.6.** Flash's 91.6 is the *preview* build's number — the 0731
  card doesn't list LiveCodeBench at all, so it was never re-run. Treat the 2-point Pro lead
  as unmeasured, not as a Pro win.
- **SWE-bench Verified: Pro 80.6% vendor-reported, 74% on NIST CAISI's independent re-run.
  Flash-0731 has no score.** Its card publishes nine agent benchmarks and SWE-bench isn't
  among them. That's a gap in the evidence rather than a measured loss, and it's the single
  weakest point in this decision.
- **Long-context retrieval: MRCR 1M 83.5 vs 78.7, CorpusQA 62.0 vs 60.5.** Real, modest, and
  the most relevant of Pro's remaining edges given that Claude Code leans on long context.

Pro's 5-point MRCR edge doesn't offset a 10-point Terminal-Bench and 40-point DeepSWE deficit
at 3× the price and 2.6× the latency. LiveCodeBench measures isolated competitive-style
generation — the least representative benchmark for a harness that edits files across a repo.

## Consequences

**`fast` and `coding` now resolve to the same model.** The split stops buying anything once
the cheap model also wins the expensive category. Left as two categories because they carry
different weight profiles and will diverge again on the next release; not treated as a defect.

**The recommender independently reached the same pick.** Once the collectors were unblocked,
the 2026-08-02 run scored `DeepSeek-V4-Flash` top for coding at 0.787 — so the category reads
`ok` rather than drift, and this stops being the deliberate override it had been since June
(when the algorithmic pick was GPT-5.5, dropped as too expensive via IU). The manual switch and
the algorithm agreeing on separately-sourced evidence is the strongest confirmation available
here.

## Open

1. ~~`metric_snapshot` is stale and `collect` can't run headless.~~ **Closed 2026-08-02.** The
   three `op://vps/modelpick/*` refs were added to the mini's `headless.refs` and sealed into
   the cache, so `bun run refresh` now runs headless — 4/4 steps, 195/296 models probed, 923
   metrics collected. This had been open since 2026-07-31 and is why the catalog missed 0731
   for a month.
2. **Which Flash weights IU serves is unverified.** The refreshed catalog still lists only
   `DeepSeek-V4-Flash` — no `-0731` id. 0731 kept the same architecture and size (284B total
   / 13B active), so the live throughput measurements can't distinguish the builds either.
   Carried over unchanged from [hermes-brain.md](./hermes-brain.md). **Still open.**
3. ~~The 69.1 coding index rests on one aggregator (modelgrep).~~ **Closed 2026-08-02.** The
   ArtificialAnalysis API returns 69.1 / 59.4 directly, matching the researched figures.

The refresh also surfaced two unrelated drifts not addressed here: `fast` now recommends
GLM-5.2 over DeepSeek-V4-Flash, and `orchestrator` recommends `claude-opus-5` over the
committed `claude-opus-4-8`. Both need their own investigation.

Reverting is a one-line change to `MY_STACK` in `src/db/seed.ts` plus `bun run db:seed`.
Re-open when DeepSeek ships the V4-Pro GA it has announced, or if a SWE-bench Verified score
lands for Flash-0731 and contradicts the agentic picture.
