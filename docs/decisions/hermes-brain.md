# Hermes Brain — Sonnet → Kimi-K2.6 → DeepSeek-V4-Pro → DeepSeek-V4-Flash

**Current:** `DeepSeek-V4-Flash` since 2026-07-31, with fallback `claude-sonnet-4-6-eu`
unchanged. Flash overtook Pro on the day DeepSeek re-post-trained it (`DeepSeek-V4-Flash-0731`)
— it now leads Pro on the Artificial Analysis Intelligence Index while costing ~3× less per
output token and answering ~2.5× sooner on the IU endpoint. See the 2026-07-31 section below,
including what that switch gives up (factual recall) and what could not be verified (which
Flash weights IU actually serves).

## History

**Sonnet 4.6 → Kimi-K2.6 (original decision).** Hermes touches personal data (calendar,
health, email via argo), so data residency was the deciding factor. Kimi-K2.6 was EU-resident
(Azure Sweden Central, verified via `x-ms-region`), off Max, reasoning + tool-calling, ~256k
context. Single-backend, so throttle-prone under load — see the original resilience notes
this record used to carry (fallback chain, backoff, `claude-sonnet-4-6-eu` as the EU-safe
non-Kimi option).

**Kimi-K2.6 → DeepSeek-V4-Pro (2026-06-02).** Switched the brain and the four auxiliary
tasks (web_extract, compression, approval, title_generation → DeepSeek-V4-Flash). Both
verified EU-resident (Azure Spain Central) against the IU endpoint at the time, with
reasoning/tool-calling/max_tokens confirmed. Vision and the `claude-sonnet-4-6-eu` fallback
were unchanged. This is the config hermes-agent actually runs today — the "Kimi-K2.6" framing
above is history, not current state (this record had gone stale relative to the repo before
the 2026-07 review below caught it).

## 2026-07 bake-off: GLM-5.2 and the rest of the refreshed catalog

A portal refresh (203 models, up from ~47 stale) surfaced several new-generation candidates —
Kimi-K2.7 Code, GLM-5.1/5.2, Qwen3.7-Max, MiniMax M3, NVIDIA Nemotron 3 Ultra, Claude Sonnet 5,
GPT-5.5/5.6 — prompting a review of whether DeepSeek-V4-Pro still holds up. External
leaderboard throughput numbers looked suspicious (GLM-5.2 claimed ~175 tok/s vs DeepSeek-V4-Pro
at ~59 tok/s, an implausible gap), so rather than trust vendor/leaderboard figures, this
became a live bake-off against the real IU endpoint.

**New permanent capability:** `scripts/benchmark-throughput.ts` and
`scripts/benchmark-tool-calling.ts` (`bun run benchmark`, `bun run benchmark:tools`) — measure
real decode throughput/TTFT and multi-step agentic tool-calling reliability directly against
IU, writing to `metric_snapshot` with `source: "live"`. This is the general answer to
"external benchmarks don't reflect what we actually get from our hosting provider" and is
reusable for any future model review, not just this one.

**Throughput (live, not leaderboard):**

| Model | Throughput | vs. leaderboard claim |
|-|-|-|
| DeepSeek-V4-Pro | 92.0 tok/s | far higher than the ~59 tok/s leaderboards implied |
| GLM-5.2 | 106.2 tok/s | roughly in line, not the ~175 tok/s claimed |
| DeepSeek-V4-Flash | 130.0 tok/s | |
| MiniMax M3 | 71.3 tok/s | |
| Qwen3.7-Max | 48.0 tok/s | claimed *fastest* on paper, measured *slowest* live |

**Multi-step tool-calling reliability** (3-tool scripted scenario: weather check → conditional
task creation → notes search, synthetic results fed back over up to 6 rounds):

| Model | Tool coverage | Args valid | Finished | Verdict |
|-|-|-|-|-|
| DeepSeek-V4-Pro | 3/3 | 3/3 | yes | pass — 14.1s |
| DeepSeek-V4-Flash | 3/3 | 3/3 | yes | pass — 7.8s |
| GLM-5.2 | 3/3 | 3/3 | yes | pass — 10.7s |
| MiniMax M3 | 3/3 | 3/3 | yes | pass — 9.3s |
| Qwen3.7-Max | 2/3 | 2/2 | no | **fail** — dropped the conditional tool, connection died mid-scenario |
| Kimi-K2.7-Code | 2/3 | 1/2 | yes | **fail** — dropped the same conditional tool, one malformed arg |

Qwen3.7-Max and Kimi-K2.7-Code are cleanly ruled out: both fail on the same tool (the
conditional one that requires reasoning "it rained → therefore create this"), and Qwen's
paper-fastest throughput claim was the least true of any candidate measured.

**GLM-5.2 vs DeepSeek-V4-Pro — the real contest.** GLM-5.2 won on raw speed (both live
throughput and total task time) and matched DeepSeek-V4-Pro exactly on tool-calling
reliability. Broader research (external benchmarks, not this repo's data) puts DeepSeek-V4-Pro
ahead on quality — SWE-bench Verified 80.6 vs 77.8, LiveCodeBench 93.5 vs 81.9, MMLU-Pro 87.5
vs 86.0, GPQA 90.1 vs 86.0 — plus cheaper pricing and 5x the context window (1M vs 200k).
GLM's own documented strength (clean, low-hallucination tool-calling) is real and shows up in
the benchmark above, but it isn't a decisive edge over an incumbent that already passes
cleanly.

**Residency, as one factor among several, not an absolute gate.** Checking response headers
against the live IU endpoint found both models routed through the same generic
`Requesty-Global` proxy layer today, with GLM-5.2 forwarded to `fireworks/glm-5.2` — Fireworks
is a US-hosted inference provider, and no EU verification exists for GLM-5.2 anywhere (no
`capability_probe` row, never used in hermes-agent). DeepSeek-V4-Pro has the June 2026
Azure-Spain-Central verification behind it, though that same header check couldn't
independently re-confirm it today (the generic proxy layer doesn't expose region either way).
This is a real, unresolved gap for GLM-5.2 — one input into the decision, not disqualifying on
its own.

## Verdict (2026-07-11 bake-off)

**Stay on DeepSeek-V4-Pro.** Closer than the external leaderboard numbers suggested — GLM-5.2
is a genuine, verified-fast, verified-reliable alternative — but "faster and equally reliable"
isn't "clearly better," and DeepSeek-V4-Pro still leads on quality, cost, context, and has the
only verified residency precedent of the two. No demonstrated benefit strong enough to change
a running, prompt-tuned system. Revisit if GLM-5.2's residency gets independently verified or
its quality gap closes further.

## 2026-07-31: DeepSeek-V4-Flash-0731 takes the brain

Three weeks after the bake-off above, DeepSeek re-post-trained Flash and shipped it the same
day this was evaluated. `DeepSeek-V4-Flash-0731` keeps the April architecture and size
(284B total / 13B active, against Pro's 1.6T / 49B) and changes only the weights — the API
alias `deepseek-v4-flash` moves with it, so there is no new model id to point at.

**What the update did to the agentic numbers** (external, cross-verified; Artificial Analysis
plus DeepSeek's own changelog):

| Signal | April Flash | Flash-0731 | V4-Pro |
|-|-|-|-|
| AA Intelligence Index | 40 | **50** | 44 |
| GDPval-AA (agentic work) Elo | 1189 | **1559** | — |
| Terminal-Bench | 56.9% (2.0) | **79–82.7%** (2.1) | 67.9% (2.0) |
| Toolathlon | 47.8% | **70.3%** (verified) | 51.8% |
| AA-Omniscience hallucination | — | +7…12 pts better | — |

Benchmark versions moved (Terminal-Bench 2.0 → 2.1) and Pro was not re-run on the new
harness, so the right-hand column is a reference point, not a like-for-like control. The
directional claim — Flash-0731 is now at least Pro-class for tool-driven agent work, at a
fraction of the cost — is carried by the AA index, which does score both on the same scale.

**Where Pro still wins, and why it doesn't decide this.** Pro leads on factual recall:
SimpleQA-Verified 57.9% vs 34.1%, MRCR 1M-context recall 83.5% vs 78.7%, BrowseComp 83.4% vs
73.2% (preview-weights numbers). That is a real gap and the one thing this switch gives up.
It matters less for Hermes than the headline suggests: Hermes answers factual questions by
*calling* something — argo for personal data, the research-gateway skill for anything
substantive — and SOUL.md already routes it that way. The failure mode to watch for is Flash
answering from memory instead of reaching for a tool; ToolFailBench puts Flash in the
"disciplined" cluster (1.20% unnecessary-tool-use, 75.84% clean tool-use), which is the
opposite failure mode, but that measurement predates 0731.

**Live against IU** (`bun run benchmark` / `benchmark:tools`, two throughput passes):

| Measure | DeepSeek-V4-Pro | DeepSeek-V4-Flash |
|-|-|-|
| TTFT, avg over 3 turns | 26.4s / 10.7s | **4.3s / 4.5s** |
| Decode throughput | 98–611 tok/s (unstable) | 121–165 tok/s |
| 3-tool scenario | 3/3 tools, args valid, finished — 16.2s | 3/3 tools, args valid, finished — **12.3s** |

Time-to-first-token is the number that decides this for a Slack assistant, and it is not
close: Pro takes 10–26s to start talking, Flash ~4s. Pro's throughput figures are unstable
because the IU stream reports reasoning tokens in the same completion count (one pass
recorded 4662 tokens against a 600-token cap), so treat the tok/s column as indicative and
TTFT as the real signal. The scripted 3-tool scenario no longer discriminates — both models
pass it cleanly, as they did on 2026-07-11 — so it now works as a regression gate, not as a
selection criterion.

**Post-switch routing check** (five prompts through the gateway API against the live agent,
German in / German out, side-effect-free by design): sleep + recovery → argo-api Garmin (19s);
"today and tomorrow" → both calendars merged, personal and work (35s); "which MRs need my
review" → GitLab MRs joined to their Jira tickets, with a judgment call to close an 18-month
stale revert instead of reviewing it (30s); "search my notes for Hermes" → obsidian across
seven files, synthesized rather than dumped (35s); and a control question needing no tool
("capital of Australia") answered in 2s without reaching for one. No misroutes, no dropped
tool, no over-calling — this is the resilience requirement #5 re-test, and Flash passed it.

**Two things could not be verified, and both are recorded as open.**

1. **Which Flash weights IU serves.** The IU catalog id is unchanged (`DeepSeek-V4-Flash`,
   no `-0731` variant in `/v1/models`), the Requesty proxy layer exposes no version or
   region header, and asking the model directly is worthless — V4-Pro self-reports as
   "DeepSeek-V3-0324". If IU follows the upstream alias it is already serving 0731; if its
   provider pins a snapshot it may lag by days. The live IU measurements above hold either
   way, because they measure what IU actually serves.
2. **Leaderboard metrics in `modelpick.db` are stale** (2026-07-11) and could not be
   refreshed during this decision: `bun run collect` needs `op://vps/modelpick/*`, which is
   not in the mini's `headless.refs` allowlist, and `op` cannot run interactively on a
   headless box. The external numbers above therefore come from research, not from
   `metric_snapshot`. Seeding those three refs would let the full `refresh` pipeline run on
   the mini.

**Residency is unchanged in substance.** Both DeepSeek aliases were verified EU-resident
(Azure Spain Central) on 2026-06-02; since the Requesty proxy layer went in, `capability_probe`
records `residency: unknown` for both and neither can be re-confirmed from headers. Flash is
not a new exposure either way — it has been the auxiliary model since 2026-06-02, and
compression already feeds it full conversation content.

### Verdict

**Switch the brain to `DeepSeek-V4-Flash`**, fallback `claude-sonnet-4-6-eu` unchanged. The
case is cost (~3× cheaper per output token), latency (~2.5× faster to first token, measured on
IU), and an intelligence index that now puts Flash *ahead* of Pro rather than 4 points behind.
Pro was not added as an intermediate fallback deliberately: both aliases traverse the same
IU → proxy → DeepSeek path, so Pro would not survive the outage class the fallback exists for,
and Flash's 2500-vs-500 concurrency ceiling makes it the less throttle-prone of the two.

Revert is one line in `hermes-agent/config.yaml` plus `hermes gateway restart`. Re-open this
if factual-recall regressions show up in daily use (the SimpleQA gap is the predicted failure
mode) or if IU turns out to be pinning pre-0731 weights.

## 2026-08-10: Luna (`gpt-5.6-luna`) bake-off — residency prompts a re-look

OpenAI's Luna pricing refresh prompted a check on whether it now beats DeepSeek-V4-Flash for
Hermes. Two catalog traps first: the display name "GPT 5.6 Luna" is shared by three catalog
ids, and only `gpt-5.6-luna` is actually routed on IU — `gpt-5.5-pro` and
`gpt-5.5-pro-2026-04-23` both read `not_routed` in every `capability_probe` since June.

**Residency — the deciding signal.** `capability_probe`'s residency check reads live response
headers (`x-ms-region` / `x-middleware-forwarded-server` for "sweden"), not guesswork.
`gpt-5.6-luna` verifies **`eu` (Azure Sweden Central)** as of 2026-08-02. `DeepSeek-V4-Flash`
reads **`unknown`** on every probe since the Requesty proxy layer went in — it strips the
headers the check relies on. Both models are believed to run on Azure infrastructure, but that
can't currently be independently re-confirmed for DeepSeek from IU's response headers, and
"on Azure" alone doesn't guarantee EU data residency — only a Regional or Data-Zone-EU
deployment type does; a Global deployment can still leave the region. Which deployment type IU
configured for either model is unverified from this end.

**Live IU benchmark, 4 independent runs each** (`bun run benchmark`, `bun run benchmark:tools`,
2026-08-10 — one initial run plus 3 same-day repeats per model, to separate real stability from
a lucky sample):

| Run | DeepSeek-V4-Flash TTFT avg | DeepSeek-V4-Flash tok/s | gpt-5.6-luna TTFT avg | gpt-5.6-luna tok/s |
|-|-|-|-|-|
| 1 | 2639ms | 124.3 | 808ms | 136.7 |
| 2 | 3435ms | 168.8 | 954ms | 143.6 |
| 3 | 2386ms | 120.9 | 779ms | 119.4 |
| 4 | 5380ms (one turn spiked to 11.5s / 702 tok/s — the reasoning-token miscount bug previously seen on Pro, now also hit Flash) | 328.3 (same outlier) | 833ms | 132.0 |

Tool-calling (3 fresh runs, both 3/3 tools + valid args + finished on every run — reliability is
a wash): Flash total time 10.7s / 14.3s / 12.1s; Luna 3.7s / 4.2s / 3.9s. **Luna is both faster
(3–8x on TTFT, ~3x on the tool-calling scenario) and the more stable of the two** — its TTFT
across all 4 runs stays inside a 175ms band, while Flash swings 2.4–5.4s and produced a fresh
reasoning-token-inflation outlier. Not close.

**Validation run (5th throughput/4th tool-calling pass, same day).** Confirms the pattern, not a
fluke: Flash TTFT 2940ms avg (range across all 5 runs: 2.4–5.4s), Luna 823ms avg (range across
all 5 runs: 779–954ms — still inside a 175ms band). Tool-calling: Flash 13.0s, Luna 3.7s, both
3/3 again. Re-ran the caching probe against Luna a second time too: `cached_tokens: 0` on all
three calls again, latency still drops call-over-call (1023→738→758ms) without being reflected
in usage — the non-reporting is consistent, not a one-off.

**Cost and quality** (Artificial Analysis, 2026-08-02): quality index 51.2 vs 49.9, coding
index 71.4 vs 69.1 — Luna edges Flash on both. External pricing is unreliable: OpenRouter says
$0.10/$0.60 per 1M in/out for Luna, Artificial Analysis says $0.20/$1.20 — a 2x disagreement
between sources, neither confirmed as IU's actual billed rate.

**Caching — live-probed, not just documented.** Sent an identical ~1,700-token static prefix
3x back-to-back to each model on IU. DeepSeek-V4-Flash's cache is real and audited: cold call
`cached_tokens: 0`, cost $0.000264; both warm calls hit `cached_tokens: 1664/1713` at
cost $0.0000608 / $0.0000493 — the effective cache-hit input rate backs out to exactly
DeepSeek's official $0.0028/M, so IU passes the real discount through, verifiably, via a `cost`
field on every response. **`gpt-5.6-luna` reported `cached_tokens: 0` on all three calls**
despite an identical prefix well over the 1,024-token minimum, seconds apart — either IU's Luna
route doesn't cache, or it caches without reporting it (total latency did drop 1750ms → ~760ms
call-over-call, and IU's own `latency_checkpoint.service_ttft_ms` trended down too, so *something*
sped up) — and Luna's response carries no `cost` field at all, so there's no way to bill or
verify it either way. Matches a Microsoft-confirmed bug (July 2026) where GPT-5.6 Luna doesn't
report cache hits on the Responses API — this test hit Chat Completions, which MS's docs say is
unaffected, so either the bug is broader than documented or IU's routing triggers it regardless.
**Bottom line: Flash's caching is proven and cheap on IU today; Luna's cannot currently be
trusted or verified through IU**, which cuts against its cost advantage on repeat-prefix-heavy
workloads like Hermes's system prompt, even though Luna wins decisively on raw latency.

**GDPR, external research (2026-08-10, cross-verified via research-gateway).** DeepSeek's own
API (`api.deepseek.com`) is not GDPR-viable for personal data: China-hosted, no EU adequacy,
trains on user data by default per its April 2026 ToS, no DPA with SCCs. Italy ordered it
blocked (Jan 2025); Germany, Poland, Belgium, France, and Ireland have open investigations.
Azure OpenAI Standard/Data-Zone-EU deployments are covered by Microsoft's EU Data Boundary
(completed Feb 2025) and the standard Microsoft Products DPA — no training on customer data,
contractually. Under EDPB Opinion 28/2024, an EU-hosted deployment of an open-weight model
(DeepSeek included) resolves the data-*flow* risk but not the model-*provenance* risk
(whether personal data survives unlawfully in the trained weights) — a residual, documented-
assessment-only risk that doesn't apply to OpenAI's models. None of this tells us which path
IU's `DeepSeek-V4-Flash` alias actually uses; that's the open item below.

### Verdict

**`gpt-5.6-luna` is the stronger candidate on latency, stability, and residency;
DeepSeek-V4-Flash is the stronger candidate on proven cache economics.** Neither axis is close:
Luna is 3–8x faster and visibly more stable across repeated same-day runs; Flash has a
live-verified, audited cache discount that Luna's route doesn't demonstrate at all. The
residency gap matters most for an agent that touches calendar/health/email, and latency is the
metric that decided the previous Pro→Flash switch too — both favor Luna, so it wins on balance
despite Flash's caching edge (economically immaterial at personal-assistant scale).

Still open, doesn't block the switch: get IU to confirm the Azure deployment type behind both
models (Regional/Data-Zone-EU vs Global — a live "eu" header reading is a positive signal, not
a deployment-type guarantee), and ask IU/Microsoft why `gpt-5.6-luna` isn't reporting cache hits
through their Chat Completions route.

**2026-08-10: switched.** All three IU consumers of `DeepSeek-V4-Flash` for this brain/gateway
role moved to `gpt-5.6-luna`:

- **hermes-agent** — `config.yaml` (brain + `web_extract`/`compression`/`approval`/
  `title_generation` auxiliaries) and every doc/skill naming the brain by id, committed direct
  to master (`dfadbb3`). Gateway restart is a separate manual step, not done as part of this.
- **research-gateway** — `IU_LEAD_MODEL`/`IU_WORKER_MODEL` defaults + a `gpt-5.6-luna` cost-rate
  entry (cache discount deliberately *not* assumed, per the live probe above), draft PR
  [jkrumm/research-gateway#2](https://github.com/jkrumm/research-gateway/pull/2). Tests pass
  (269/269); not yet smoke-tested against the live IU endpoint from inside that repo.
- **argo** — the `/ai/v1/*` AI gateway (`DEEPSEEK_MODEL` env default, titling/classification
  only, not the Hermes agent itself) + a cost-rate entry, draft PR
  [jkrumm/argo#5](https://github.com/jkrumm/argo/pull/5). Typecheck + lint pass.

All three still carry the same open item: the OpenRouter reference price used for
`gpt-5.6-luna` ($0.10/$0.60 per 1M in/out) is not IU's confirmed billed rate — flagged in-line
at each rate table. `usage-tracker/src/pricing.ts` (separate repo, documented there as the
authoritative copy of these rates) still needs a matching entry, tracked as a manual follow-up
in both PRs.

## Resilience requirements (carried over, still current)

1. DeepSeek-V4-Pro primary over the OpenAI-compat transport.
2. On 429/5xx: exponential backoff (2–3×), then fall back to `claude-sonnet-4-6-eu`.
3. Log which model actually served each response (never the key).
4. Verify tool_calls schema against what Hermes's skill domains expect; adjust the adapter if
   needed.
5. A model swap is not a drop-in for a prompt-tuned agent — re-test skill domains and tune
   prompts where a new brain diverges in formatting/system-prompt adherence.

Operational specifics (credential resolution, request-layer wiring, validation skill) stay in
the hermes-agent repo and dotfiles. This record captures the *choice* and the reasoning behind
it.
