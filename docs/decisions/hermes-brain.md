# Hermes Brain — Sonnet → Kimi-K2.6 → DeepSeek-V4-Pro → DeepSeek-V4-Flash → gpt-5.6-luna

> **Current verdict (2026-09-13):** brain, delegation and compression run
> **`deepseek-v4.1-flash`** at `reasoning_effort: high` on `chat_completions`; fallback is
> `gpt-5.6-luna`. An owner decision for capability over cost — see §2026-09-13, and its
> same-day correction: V4.1 does cache (92–96% live), so a real thread costs ~2× Luna, not 14.9×.
> **Status of this record:** the 2026-09-12 (decisive) verdict for Luna is superseded by
> §2026-09-13. Its measurements stand; only the weighting changed.
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

**2026-09-11 update:** re-run against `deepseek-v4.1-flash`. Luna still wins — and the
challenger is not on the Anthropic route at all, so ccbench cannot score it. See the last
dated section.

**2026-09-02 update:** re-run against `gemini-3.8-flash` (IU's newest Gemini release,
superseding 3.7). Luna still wins — see the dated section near the end for the live numbers.

**Current:** `gpt-5.6-luna` since 2026-08-10, with fallback `claude-sonnet-4-6-eu` unchanged.
Luna won on latency (3–8× faster to first token than DeepSeek-V4-Flash, and stable across
repeated runs) and on the only live-verifiable residency signal on IU (`x-ms-region: Sweden
Central`). Its one open weakness at the time — cache hits not reported through IU — closed on
2026-08-20, when a re-probe measured 99.9% cache hits with a 9× cost drop. Held against
`gemini-3.7-flash` on 2026-08-20; see the last section for why.

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

> **Superseded** — see §2026-07-31: DeepSeek-V4-Flash-0731 takes the brain. Kept for the
> measurements; the conclusion below did not survive.

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
2. **Leaderboard metrics in `modelpick.db` were stale** (2026-07-11) and could not be
   refreshed during this decision: `bun run collect` needs `op://vps/modelpick/*`, which was
   not in the mini's `headless.refs` allowlist, and `op` cannot run interactively on a
   headless box. The external numbers above therefore came from research, not from
   `metric_snapshot`. **Closed 2026-08-02** — those refs are seeded and `bun run refresh` runs
   headless (see [coding-model.md](./coding-model.md) Open item 1).

**Residency is unchanged in substance.** Both DeepSeek aliases were verified EU-resident
(Azure Spain Central) on 2026-06-02; since the Requesty proxy layer went in, `capability_probe`
records `residency: unknown` for both and neither can be re-confirmed from headers. Flash is
not a new exposure either way — it has been the auxiliary model since 2026-06-02, and
compression already feeds it full conversation content.

### Verdict

> **Superseded** — see §2026-08-10: Luna (`gpt-5.6-luna`) bake-off — residency prompts a
> re-look. Kept for the measurements; the conclusion below did not survive.

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

## 2026-08-20: `gemini-3.7-flash` bake-off — Luna holds

IU announced `gemini-3.7-flash` on the `/gemini` **and** `/openai` endpoints (alongside
`glm-5.3` and `qwen-3.8-max` on `/openai`, and `deepseek-v4-pro` now pointing at
`deepseek-v4-pro-0813`). Headline claim was speed. Measured live against IU with a new
`scripts/benchmark-bakeoff.ts` (`bun run benchmark:bakeoff [routing|throughput|cache|tools]`),
which extends the existing benchmarks with hidden-reasoning-token accounting, prompt-cache
economics, per-turn cost at vendor list rates, and backend routing headers.

**`/gemini` is a real native passthrough.** `POST /gemini/v1beta/models/{id}:generateContent`
and `:streamGenerateContent?alt=sse` with `x-goog-api-key` behave like Google's own API:
`usageMetadata` (`thoughtsTokenCount`, `cachedContentTokenCount`), `thoughtSignature` parts,
`functionDeclarations` tools, `systemInstruction`. 44 models listed there vs 290 on `/openai`.

### Residency: it is *not* EU, and IU's own error message proves it

| Model | `x-middleware-forwarded-server` | Region evidence |
|-|-|-|
| `gpt-5.6-luna` | `IU AI Middleware Sweden Central Azure` | `x-ms-region: Sweden Central` |
| `gemini-3.7-flash` (both routes) | `Gemini API` / `Gemini API OpenAI direct` | none — no region header at all |
| `gemini-3.5-flash-eu` | `LiteLLM 2026 Gateway GDPR` | response `model: vertex_ai_eu/gemini-3.5-flash` |
| `glm-5.3`, `qwen3.8-max` | `Requesty-Global` | none (same unverifiable class as before) |

IU runs two Gemini paths: a **GDPR path** (LiteLLM → Vertex project `iu-ai-6123`, EU regions)
exposed under the `-eu` name suffix, and a **direct path** to Google's global Gemini API for
everything else. `gemini-3.7-flash` is only on the direct path — there is no
`gemini-3.7-flash-eu`, and the native model list even labels the EU one "3.5 Flash via EU".

This is not inference from a missing header. Sending tool *results* back on the `/openai`
route makes LiteLLM take over the request and fail loudly:

```
litellm.NotFoundError: Vertex_aiException - 404
Publisher model `projects/iu-ai-6123/locations/europe-west1/publishers/google/models/gemini-3.7-flash`
was not found or your project does not have access to it.
Received Model Group=vertex_ai_europe_west_1/gemini-3.7-flash
```

IU's EU Vertex project does not carry 3.7 Flash. Google's own position is the same, from the
other end: the AI Studio / `generativelanguage.googleapis.com` API offers **no data-residency
guarantee of any kind** — a Google moderator's answer is "use Vertex AI if residency is a
concern." The paid tier does give Art. 28 processor status, ZDR and a no-training commitment
via the `business.safety.google` DPA + SCCs, so this is a *location* gap, not a training gap.
For a brain that reads calendar, health and email, that is the same gate that decided
Kimi→DeepSeek and DeepSeek→Luna.

### Latency: Luna wins where it is felt, Gemini wins where it isn't

Short Hermes-shaped prompts (10 German one-liners, system prompt, streamed):

| | TTFT median | TTFT min–max | wall median | thinking tokens (median) |
|-|-|-|-|-|
| `gpt-5.6-luna` | **674ms** | 494–2600ms | **1152ms** | **0** |
| `gemini-3.7-flash` | 3156ms | 1827–13728ms | 3231ms | 300 |

3-turn long-form conversation, 4 passes each: Luna TTFT 1107–1514ms, Gemini native
3792–5239ms. Gemini decodes far faster once it starts (253–452 tok/s vs Luna 68–100), but that
is partly chunk granularity, not smoothness — on the same 250-word prompt Luna emitted **389
text chunks (median 4 chars)** and Gemini **15 chunks (median 117 chars)**, and both finished
within ~200ms of each other (Luna last chunk 6271ms, Gemini 6070ms). Total conversation time is
a wash (Luna 15.6–16.2s, Gemini 13.9–19.0s). **Same finish time, 3s later start, chunkier
delivery** — for a Slack assistant that is strictly worse.

The cause is thinking, which is on by default at `medium` — and it **can** be turned down, which
was worth chasing before writing the model off. `generationConfig.thinkingConfig.thinkingLevel:
"low"` (native) and `reasoning_effort: "none"` (`/openai`) both work; `"MINIMAL"` is rejected
outright ("Thinking level MINIMAL is not supported"), and `thinkingBudget: 0` works but is the
weaker lever. "Low" is a budget hint, not an off switch: on trivial prompts it lands at 0 thought
tokens, on real generation it still spends 380–650 per turn (think/visible ratio 2.0–2.4 → 0.7–0.8,
not → 0).

Gemini 3 also counts thoughts against `maxOutputTokens`, so a 600-token cap spends the whole
budget thinking and truncates the answer — the first pass of this bake-off had to be thrown away
and re-run at 4000.

**Best-config vs best-config** (`thinkingLevel: "low"` against Luna at `reasoning_effort: "none"`,
3 passes each plus 20 short-prompt samples). Turning thinking down is worth a lot to Gemini — it
roughly halves TTFT, cuts cost ~40%, and makes it the *fastest* of the four on total conversation
time. It does not close the gap that matters:

| | Luna, effort=none | Gemini 3.7, thinking=low |
|-|-|-|
| TTFT median, short prompts (n=20) | **652ms** (p90 921ms) | 1324ms (p90 2178ms) |
| TTFT, 3-turn long-form | **562–689ms** | 1821–1875ms |
| 3-turn conversation wall | 11.5–12.4s | **9.2–9.4s** |
| 3-tool scenario | **3/3, 3.6–4.0s** | 3/3, 4.0–5.5s |
| 20 short prompts, cost | **$0.00122** | $0.01141 (9.4×) |
| 3-turn conversation, cost | **$0.00126** | $0.00713 (5.7×) |

Two side findings from the same sweep. Luna at `reasoning_effort: "none"` beats Luna at default
on every axis in this workload — TTFT 1071→605ms, tool scenario 5.7→3.6s, cost −20% — worth a
separate look for Hermes, where the brain's job is routing to tools rather than reasoning in
place. And Gemini at *default* thinking failed the tool scenario once (2/3 tools, no final
answer) where `thinking=low` passed 3/3 in every run; more thinking made the agent loop less
reliable, not more.

### Tokens and cost

Verified list rates: Luna **$0.20 / $0.02 cached / $1.20** per 1M (post-2026-07-30 cut, Azure
matches, re-confirmed live against `openrouter.ai/api/v1/models` on 2026-08-20). Gemini 3.7 Flash
**$0.75 / $0.075 / $3.75** intro — **doubling to $1.50/$7.50 on 2027-01-01**. Both bill thinking
at the output rate. IU no longer returns a `cost` field on any route (DeepSeek's is gone too), so
these are vendor list prices, not IU's billed rate.

**The $0.10/$0.60 trap.** Luna's *batch* tier is exactly half its standard rate, and that is the
figure the argo and research-gateway rate tables were carrying — not a later price cut. Same
shape one model over: `gpt-5.6-terra` reads $2.00/$12.00 today while `gpt-5.6-sol` reads
$2.50/$15.00, which is Terra's stale launch price, so a stale Terra entry looks plausible
forever. Any rate lifted from a reseller needs its tier checked before it lands in a cost table.

**Sensitivity.** These are vendor list prices. OpenRouter resells Gemini 3.7 Flash at
$0.375/$1.875 — half Google's list, i.e. flex-tier — while pricing Luna at Google-list parity
($0.20/$1.20). If IU bills nearer resale than list, the cost gap narrows from ~5.7× to ~2.8×.
Luna stays the cheaper model under either assumption, so this does not move the verdict, but the
size of the gap is softer than a single number suggests.

| Measured scenario | `gpt-5.6-luna` | `gemini-3.7-flash` | ratio |
|-|-|-|-|
| 3-turn conversation | $0.00152 | $0.01183 | 7.8× |
| 3-tool agent scenario | $0.000623 | $0.005941 | 9.5× |
| thinking / visible-output ratio | 0.07–0.12 | 1.97–2.42 | ~20× |
| billed output over 8 mixed prompts | 163 tok | 825 tok | 5.1× |
| input tokens for the same 3-round tool loop | 1123 | 2066 | 1.8× (thought signatures re-sent) |

After the January price change this is a ~19× gap. Both columns are default-config; the
best-config-vs-best-config table above narrows it to 5.7–9.4×, which is the number to argue
with.

### Caching — and a correction to the 2026-08-10 record

| Prefix | Luna cached | Gemini cached |
|-|-|-|
| 3,155 / 3,533 tokens | **3,152 (99.9%)**, cost $0.000638 → $0.000071 | **0** on all 3 calls, both routes |
| 20,835 / 25,129 tokens | **20,832 (99.99%)** | 20,453 (81%) |

**`gpt-5.6-luna` now reports and discounts cache hits correctly on IU.** The 2026-08-10 entry
above recorded `cached_tokens: 0` on every call and flagged it as a Microsoft-confirmed bug;
re-probed today it reports 99.9% hits with a 9× cost drop. That open item is closed — Luna no
longer trades proven cache economics for latency, it has both.

Gemini's implicit cache is real but starts later: 0 at 3.5k tokens, 81% at 25k, matching
Google's documented **4,096-token implicit-cache minimum** (Luna's kicks in below 3.2k). Its
90% cached-read discount is the same percentage as Luna's, off a 3.75× higher base.

### Tool calling

Discipline is a wash: 4 prompts that need a tool and 4 that don't — **both models 0/4
over-calls and 0/4 missed calls**. The scripted 3-tool scenario: Luna 3/3 tools, valid args,
finished, 4.9–6.5s; Gemini native 3/3, valid args, finished, 7.8–11.0s.

**But the `/openai` route is unusable for Gemini agent loops.** Feeding tool results back
fails with the europe-west1 404 above — 3/3 runs, every time, mid-scenario. Anything agentic
with `gemini-3.7-flash` on IU must use the native `/gemini` endpoint and echo `thoughtSignature`
parts back verbatim.

### Verdict

**Stay on `gpt-5.6-luna`.** Tuned against tuned, Gemini 3.7 Flash is still 2× slower to first
token on short prompts (and 2.4× worse at p90), costs 5.7–9.4× more today and ~2× that again
from January, caches later and less, and — decisively for a brain that touches personal data —
has **no EU route on IU at all**, only Google's global AI Studio API. Its wins are real and
bigger than the default-config numbers suggested: with thinking turned down it *finishes* a
3-turn conversation faster than Luna does, decodes 3× quicker, and brings a 1M context window
and a genuinely clean native endpoint. For a Slack assistant, starting 700ms sooner beats
finishing 2s sooner, and neither is worth a residency downgrade.

Re-open if IU publishes a `gemini-3.7-flash-eu` alias on the LiteLLM GDPR gateway. At that
point the residency objection dies and the question becomes purely cost-vs-capability — where
Luna still leads by ~8× on measured spend.

Not evaluated, deliberately: `glm-5.3` and `qwen3.8-max` both route through `Requesty-Global`,
the same header-stripping US proxy layer that made DeepSeek's residency unverifiable; and
`deepseek-v4-pro-0813` is a Pro-line update, and the Pro line already lost this seat twice on
latency.

**Open items.** IU's actual billed rates are still unknown (no `cost` field on any route now).
The modelpick catalog now carries `gemini-3.7-flash`, `glm-5.3`, and `qwen3.8-max` — the catalog
syncs from the live `/v1/models` list on every `bun run probe`, so a portal export is no longer
the only way to add a model. No quality-index numbers (Artificial Analysis, LMArena, agentic
benchmarks) were gathered for either model in this round — the research pass was scoped to
pricing and residency.

## 2026-09-02: `gemini-3.8-flash` bake-off — Luna still holds, but the gap is narrowing

IU shipped `gemini-3.8-flash` on both `/gemini` and `/openai` (superseding 3.7, still no
`-eu` alias — only `gemini-3.5-flash-eu` and `gemini-2.5-pro-eu` exist). Re-ran
`scripts/benchmark-bakeoff.ts` live (`bun run benchmark:bakeoff all`, one pass through all
four suites, `gemini-3.7-flash` swapped for `gemini-3.8-flash` in `CANDIDATES`) rather than
trust vendor release notes.

**Residency: unchanged.** `gemini-3.8-flash` still carries no `x-ms-region` / Sweden Central
header on either transport (`Gemini API` / `Gemini API OpenAI direct` backend) — same global
AI Studio path as 3.7, no EU deployment. `gpt-5.6-luna` still verifies `Sweden Central` on
every call. This alone keeps Luna ahead for a brain touching calendar/health/email, same as
every prior round.

**Pricing confirmed live (OpenRouter, 2026-09-02):** `gemini-3.8-flash` $0.75 / $0.075 cached
/ $3.75 per 1M — identical to 3.7's intro rate, not yet the announced 2027-01-01 doubling.
Luna unchanged at $0.20 / $0.02 cached / $1.20.

**Throughput, 3-turn conversation, best-config vs best-config** (Luna `reasoning_effort=none`
vs Gemini `thinkingLevel=low` — the tuned settings the 2026-08-20 round established):

| Measure | `gpt-5.6-luna` | `gemini-3.8-flash` |
|-|-|-|
| TTFT avg | **654ms** | 1228ms (1.9×) |
| Decode throughput | 106.6 tok/s | **451.8 tok/s** (4.2×) — a real jump from 3.7's 253–452 range, now consistently at the top of it |
| Total conversation wall | 11.3s | **6.5s** — 3.8 finishes the whole exchange faster than Luna, wasn't true for 3.7 (was a wash at best) |
| Cost | **$0.00132** | $0.00448 (3.4×) |

3.8 Flash's decode speed and total wall-clock are a genuine generational improvement over 3.7
— it now *wins* on finishing time, not just ties. TTFT and cost still favor Luna by roughly
the same margin as before.

**Default-thinking config (untuned) is markedly worse and shouldn't be shipped as-is:**
TTFT 4935ms, cost $0.01450 for the same 3 turns, think/visible ratio 2.78. The
`thinkingLevel: "low"` lever from the 3.7 round still matters exactly as much on 3.8.

**Tool-calling: slower and dearer, but not broken — the first-pass numbers were two harness
bugs.** The one-pass run on 2026-09-02 reported Gemini dropping tools, a 34.9s outlier, and an
unusable `/openai` transport. A 2026-09-04 re-check at 3 passes per config found both failures
were in `benchmark-bakeoff.ts`, not in the model:

- **`maxOutputTokens: 500` in the tool suite.** Gemini 3 bills thinking against that cap (the
  throughput suite already carries the comment; the tool suite had not been updated). A
  thinking-heavy round spent the whole budget on thoughts and returned an empty candidate,
  which the harness scored as "dropped `create_task`, did not finish". Raised to 4000 → 3/3
  tools, finished, on every subsequent run.
- **The `/openai` loop dropped Gemini's thought signature.** On the OpenAI-compat route Gemini
  smuggles it through `tool_calls[].extra_content.google.thought_signature`; the harness rebuilt
  the assistant message from `id`/`name`/`arguments` and lost it. The next request then 503s out
  of the LiteLLM GDPR gateway wrapping an upstream Vertex **404** — which reads like "no EU
  deployment for this model" and is why the 3.7 round drew the same wrong conclusion. Echo the
  assistant message back verbatim and the round-trip returns 200.

Corrected numbers, 3 passes each, same scripted 3-tool scenario:

| Config | Total (3 passes) | Tools | Cost |
|-|-|-|-|
| Luna, `reasoning_effort=none` | **3.0 / 3.2 / 3.6s** | 3/3 | $0.0004 |
| Luna, default | 4.4 / 4.9 / 5.1s | 3/3 | $0.0006 |
| Gemini 3.8 `/openai`, `reasoning_effort=none` | 5.8 / 5.9 / 11.9s | 3/3 | $0.0015–0.0063 |
| Gemini 3.8 native, `thinkingLevel=low` | 9.8 / 12.0 / 15.0s | 3/3 | $0.0077–0.0119 |
| Gemini 3.8 native, default thinking | 15.4 / 21.2 / 35.5s | 3/3 | $0.0132–0.0201 |

So: **no capability failure and no config-specific regression** — 34.9s was the tail of a wide
distribution (worst re-run: 35.5s at default thinking), not a `thinkingLevel=low` cliff. What
survives is that Gemini 3.8 is 2–4× slower and 4–16× more expensive than Luna in a multi-round
loop, with far worse variance. `reasoning_effort=none` on `/openai` is the only Gemini config
that actually suppresses thinking to zero on some rounds; native `thinkingLevel=low` never went
below ~1400 thinking tokens.

**`/openai` is usable for Gemini agent loops on IU after all** — provided every assistant turn
is echoed back with `extra_content` intact. That matters beyond this benchmark: it means the
OpenAI-compat path already carries thought signatures, so a Gemini integration does *not*
require Google's SDK or a raw `/gemini/v1beta` client.

**Caching:** all three 3.8 configs read `cached_tokens: 0` on every one of 3 identical-prefix
calls (3,533 tokens) — consistent with the documented 4,096-token implicit-cache floor, same
result as the identical-size prefix test against 3.7, not a regression. Luna hit 99.9% cache
on the same test, as it has every round since 2026-08-20.

### Verdict

**Stay on `gpt-5.6-luna`.** Nothing here overturns the 2026-08-20 decision, and the reason is
**residency, not the benchmark** — Gemini 3.8 has no EU route on either transport, and this
brain touches calendar, health and email. That alone decides it; the speed and cost columns are
tiebreakers that happen to point the same way (no EU route, 1.9× slower to first token, 3–16×
more expensive, and 2–4× slower with much wider variance in a multi-round tool loop).

3.8 Flash's real win is decode speed and total-conversation wall-clock, both up sharply from
3.7 — worth tracking, since if that trend continues while residency stays unresolved it
becomes a "fast but unusable for this brain" model rather than a genuine contender. Re-open
only if IU ships a `gemini-*-eu` alias for the 3.8 line.

**Do not transplant this verdict to a service that isn't Hermes.** It is scoped to a personal
brain over personal data. A workload with no residency constraint, or one whose lead model only
does single-shot forced-`tool_choice` structured output rather than a multi-round loop, gets a
different answer — the multi-round penalty above simply does not apply to a call that never
sends a tool result back. See `docs/decisions/gemini-tool-calling-shapes.md`.

**Open items, same shape as before:** `gemini-3.8-flash` is now in the modelpick catalog — the
catalog syncs from the live `/v1/models` list on every `bun run probe`, so new IU releases no
longer need a portal export to land. IU still returns no `cost` field on any route, so all
pricing above is vendor list price via OpenRouter, not IU's confirmed billed rate. The
`thinkingLevel=low` slowdown is **closed** — re-checked at 3 passes on 2026-09-04, it was a
`maxOutputTokens: 500` truncation artifact plus distribution tail, not a regression.

## 2026-09-11: `deepseek-v4.1-flash` bake-off — Luna holds, by a wider margin than the rate card suggests

> **Superseded** — see §2026-09-12: the latency half of the V4.1 verdict is retracted and
> §2026-09-12 (final): the tool-loop objection is retracted; caching decides instead. Kept for
> the measurements; the conclusion below did not survive.

DeepSeek shipped V4.1 Flash and IU lists it. It is the first DeepSeek release since the
`-0731` build that once held this brain, it beats Luna on the (freshly recalibrated) AA
intelligence index, and its list price is the same $1.20 output. It still loses, and not
narrowly.

**Where it is reachable.** `deepseek-v4.1-flash` answers on `/openai/v1` only. It is **not on
the `/anthropic` route** — that route serves 36 ids and the DeepSeek entries there are still
`DeepSeek-V4-Flash` / `DeepSeek-V4-Pro`. Consequence: ccbench cannot score it at all (the
harness drives `claude -p` against the Anthropic route), so there is no agent-loop floor test
for this model, and it cannot become a Claude Code worker even if it were wanted as one. The
same is true of Luna, which is why neither appears in any ccbench suite.

**Residency: worse than "unverified".** The old `DeepSeek-V4-Flash` was merely opaque — a
Requesty hop reporting nothing finer than `global`. V4.1 names its upstream in the response
body: `accounts/fireworks/models/deepseek-v4p1-flash`, backend header `Requesty-Global`. So
the path is IU → Requesty → **Fireworks**, i.e. two third parties and a US inference provider,
for a brain that touches calendar, health and email. Luna, same day, same probe:
`x-middleware-forwarded-server: IU AI Middleware Sweden Central Azure`, `x-ms-region: Sweden
Central`, `x-ms-served-model: gpt-5.6-luna-2026-07-09`. This decides it on its own, exactly as
it did against Gemini 3.8 — the numbers below are tiebreakers that point the same way.

**Numbers** (`bun run scripts/benchmark-bakeoff.ts all`, 3-turn conversation + 3× identical
prefix + the scripted 3-tool scenario):

| Config | first visible token | think/visible | 3-turn wall | 3-turn cost | tools |
|-|-|-|-|-|-|
| Luna, default | **819ms** | 0.09 | **10.2s** | **$0.00141** | 3/3 |
| Luna, `reasoning_effort=none` | 660ms | 0.00 | 11.3s | $0.00128 | 3/3 |
| V4.1 Flash, default | 13,542ms | 0.78 | 48.0s | $0.00515 | 3/3 |
| V4.1 Flash, `reasoning_effort=low` | 10,847ms | 0.70 | 40.5s | $0.00358 | 3/3 |

Costs corrected after the run: the harness was adding `reasoning_tokens` on top of
`completion_tokens`, which already contains them on every OpenAI-shaped IU route. The figures
above are the recomputed ones; see [../pipelines.md](../pipelines.md) for the fix and for why
the "first visible token" column is *not* comparable to a leaderboard TTFT column.

**16× the time to the first visible token**, and `reasoning_effort` barely moves it — Requesty
accepts the parameter (HTTP 200, no error) and the think/visible ratio drops only 0.78 → 0.70,
so the effort lever that makes Luna cheap is not available here. This is thinking, not
transport: V4.1 puts its first SSE frame on the wire in 549ms, *faster* than Luna's 1,329ms,
then streams ~1,400 reasoning tokens before the first word of the answer. Fatal for a brain
whose replies stream sentence-by-sentence into TTS, and unfixable from our side.

**Cheaper on the rate card, 3–4× more expensive in practice.** $0.30/$1.20 against Luna's
$0.20/$1.20 should be near-parity; measured, V4.1 costs 3.7× more over the 3-turn conversation
and 2.9× more over the tool loop. Two things break the parity: the 0.78 think/visible ratio
(thinking bills as output), and caching. On the 3,155-token identical-prefix test Luna reads
3,152 cached tokens at $0.02/M from call 2 on — a 9× drop to $0.00007 per call, unchanged
since 2026-08-20. V4.1 Flash does report `cached_tokens` (3,046 of 3,175), but the route
publishes no cached-input rate, so a cache hit bills at full input price and its per-call cost
stays flat at ~$0.00098 — 14× Luna's cached call.

**Tool calling is genuinely fixed, and it does not matter here.** The old `DeepSeek-V4-Flash`
dropped `create_task` again on today's run (2/3 tools, same defect as the 2026-08-31 ccbench
suite). V4.1 called 3/3 with well-formed args, finished with a real answer, and did so on both
effort settings — a real improvement over its predecessor. It took 21.4s to Luna's 6.6s doing
it.

### The quality comparison, stated honestly

"V4.1 at 39.5 against Luna at 37.5" compares two configurations neither side runs. **37.5 is
Luna's max-effort row.** Its ladder, same weights and same per-token price throughout: 16.8
non-reasoning · 21.8 low · 25.8 medium · 32.4 high · 34.8 xhigh · 37.5 max. AA's 39.5 for V4.1
is likewise its "Reasoning, Max Effort" row.

So thinking is not the overhead this record originally framed it as — it *is* the quality
lever, and the objection to V4.1 is not that it thinks. It is that **nobody can decide how
much**. Measured on a hard debugging prompt at `max_completion_tokens: 4000`:

| config | 1st visible token | wall | thinking | visible |
|-|-|-|-|-|
| Luna, default | 14,227ms | 17.9s | 1,396 | 488 |
| Luna, `none` | 795ms | 4.9s | 0 | 428 |
| Luna, `low` | 3,991ms | 7.9s | 321 | 472 |
| Luna, `medium` | 5,781ms | 9.9s | 512 | 522 |
| V4.1 Flash, default | — | 38.9s | 4,000 (cap) | **0** |
| V4.1 Flash, `none` | 34,919ms | 38.2s | 3,267 | 473 |

Luna's default effort is **adaptive** — 3 thinking tokens on an easy explainer, 1,396 here —
which is exactly the behaviour a brain wants: cheap on "what's on my calendar", deep on a real
question. V4.1 has one mode, and at default effort on a 4k budget it returns no answer at all.

**Consequence for the running config:** if hermes-agent pins Luna to a low effort to protect
TTS latency, it is running a ~17–22-intelligence model, not a 37.5 one. The right shape is the
adaptive default for the brain and an explicit raise on paths that can afford to wait — a dial
that exists *because* thinking works. See [../pipelines.md](../pipelines.md) for the full
ladder and the `max_completion_tokens` trap (`high`/`xhigh` return an empty completion under a
4,000-token cap).

### Verdict

**Stay on `gpt-5.6-luna`.** V4.1 Flash is a better model than V4 Flash, and at max effort it
is genuinely smarter than Luna at the effort Hermes can afford. It still loses on the two
things that decide this brain: it is US-hosted through two proxies, and its thinking is
uncontrollable — 35s to the first word even with the effort dial turned to zero. Re-open only if IU exposes a DeepSeek deployment with
an EU region header — the AA-index gain (39.5 vs Luna's 37.5 on the new scale) is real but
cannot be spent here.

**Where it might still earn a slot:** nowhere obvious. The "521 tok/s decode" this record
originally claimed was a harness artifact; re-measured honestly it runs ~129 tok/s against
Luna's 154, and against its own leaderboard figure of 267 — Requesty serves it from Fireworks'
shared serverless tier. It is not the throughput play it looked like. See
[fast-model.md](./fast-model.md) for why it does *not* win the `fast` category either, and
[../pipelines.md](../pipelines.md) for the measurement post-mortem.

## 2026-09-12: the running config, and why `minimax-m3` never gets a bake-off

Two questions came back to this record together — "should Hermes still be on Luna" and
"didn't we disable thinking on it, which is why the TTFT looked so good". The second turns
out to be the interesting one, and the answer is no.

**Hermes runs Luna at `high` effort.** `agent.reasoning_effort: high`
(`hermes-agent/config.yaml:77` as of the 2026-09-13 rollout) is the live key; `model.reasoning_effort`
was a documented dead mirror that `resolve_reasoning_config()` never read, and has since been
removed from `config.yaml` entirely. So the brain is the
~37.5-intelligence configuration, not the ~17–22 one the 2026-09-11 section warned about.
The warning was conditional and the condition does not hold.

**Correction (2026-09-12, later the same day): the patch strips nothing today.** This record
originally claimed `patches/transport-iu-reasoning-effort.patch` silently removed
`reasoning_effort` from the `compression` and `web_extract` lanes. A full audit of the call
graph disproves it, on three independent grounds: the patch lands only in
`ChatCompletionsTransport.build_kwargs`, and the auxiliary lanes never traverse that transport
at all (`agent/auxiliary_client.py` builds its own kwargs against the OpenAI SDK); the brain
runs `api_mode: codex_responses`, so the patch never fires for it either; and the one slot that
*does* reach the patch — the `claude-sonnet-4-6-eu` fallback — is Anthropic, so it takes the
clamp branch instead, where `high` passes through unmodified. The strip branch is a **dormant
regression guard** for the case where the brain falls back to `chat_completions`, not an active
behaviour.

What is true, and was true before: **no `reasoning_effort` is configured on any auxiliary
slot.** They run at provider default. That is a gap worth closing deliberately, but it is a
missing setting, not a patch side-effect.

`web_extract` turns out to be **dead config entirely** — `hermes_cli/config_defaults.py:697`
records that "web_extract and session_search no longer use an aux LLM; leftover blocks in user
config are ignored", and no `task="web_extract"` LLM call exists. Its block, `session_search`'s,
and the stale `DeepSeek-V4-Pro` entry in `providers.custom.models` (`config.yaml:19`) should be
deleted together.

**`minimax-m3` is screened out without a bake-off.** It is the weakest model in the
candidate set on every axis that matters here, and it fails the same residency gate that
already disqualified `deepseek-v4.1-flash`:

| model | AA quality | AA coding | GPQA-Diamond | live probe residency |
|-|-|-|-|-|
| `gemini-3.8-flash` | 41.2 | 76.3 | 0.954 | unknown |
| `gpt-5.6-luna` | 37.5 | 71.4 | 0.916 | **eu** (Sweden Central) |
| `minimax-m3` | 29.6 | 58.6 | 0.813 | unknown |

Luna is the only candidate that probes EU. For a brain that touches calendar, health and
email that settles it before capability is weighed — and `minimax-m3` would lose on
capability anyway. It aces ccbench, which measures whether a model can hold an agent loop
and says nothing about whether it is smart; reading that as a quality result is exactly the
error ccbench's own record warns against.

**Verdict: stay on `gpt-5.6-luna` at `high`.** The open action is in `hermes-agent`, not
here: decide deliberately what effort `compression` and `web_extract` should run at, and
either move them to `codex_responses` or record that no-effort is intended. Tracked as
slots `hermes/compression` and `hermes/web-extract` in modelpick's `deployment` table,
both stamped `thinking: off` so the dashboard shows what reaches the wire rather than what
the YAML says.

## 2026-09-12: the latency half of the V4.1 verdict is retracted

> **Superseded** — see §2026-09-12 (final): the tool-loop objection is retracted; caching
> decides instead. Kept for the measurements; the conclusion below did not survive.

The 2026-09-11 section above rejected `deepseek-v4.1-flash` on three grounds: residency,
uncontrollable thinking, and "16× the time to the first visible token". `bun run bench:fast`
(five graded tasks, full effort ladder, three repeats, medians, **total wall to a correct
answer** — [`docs/experiments/fast-2026-09-12/report.md`](../experiments/fast-2026-09-12/report.md))
retires the third ground and narrows the second.

- **It is not slower.** Median wall 1110ms at `medium` against Luna's 1262ms at `default`, with
  a *better* pass rate (14/15 vs 13/15). On the 1,200-word longform task it finishes in 14.4s
  against Luna's 15.7s **despite starting 5.5s later** — its measured crossover against Luna is
  **107 visible tokens**. The 13.5s figure in the section above is a time-to-first-token
  measurement on a single open-ended generation prompt; on total wall for that same class of
  task, V4.1 wins.
- **`reasoning_effort` is honoured after all.** The earlier "Requesty accepts it and ignores it"
  reading came from trusting `completion_tokens_details.reasoning_tokens`, which this route
  reports as `0` while billing hidden thinking inside `completion_tokens` (live probe: a
  one-word answer costs 22 completion tokens with `reasoning_tokens: 0`). Inferring the split
  the way `benchmark-bakeoff.ts` already does shows the ladder moving: think:visible 5.89 at
  `medium`, 7.45 at `default`.
- **What survives: the spend is unpredictable.** Thinking spread 3,000–6,200 tokens per cell
  against Luna's 28–510. It returns 273 completion tokens for a 94-character answer at a 4k cap
  and 2,191 for the same answer at 16k. It is erratic on `extract` — 1.1s, 2.1s, 8.9s on three
  identical calls. And below roughly a 1k budget it **starves**: `finish_reason: length`, zero
  visible tokens, no answer at all.

**The brain stays on `gpt-5.6-luna`, for a narrower reason than before.** bench-fast is
single-call; it says nothing about a tool loop, and the tool loop is what a brain is. The
standing tool-suite measurement still has Luna finishing the 3-tool scenario in 6.6s against
V4.1's 21.4s, and Luna's per-turn spend is predictable in a way V4.1's is not — which matters
more for a brain whose replies stream sentence-by-sentence into TTS than a 150ms median
advantage does.

**Re-open trigger, concretely:** run the bakeoff tools suite for both at a 4,000-token budget
and `reasoning_effort: medium`. The old tool-suite numbers were taken before the budget trap was
understood, so they may be measuring starvation too. If V4.1 completes the 3-tool scenario
within ~1.5× of Luna's wall clock at a predictable token spend, this record should change.

## 2026-09-12 (final): the tool-loop objection is retracted; caching decides instead

The brain was held on `gpt-5.6-luna` above on one surviving argument — that V4.1 Flash took
21.4s to complete the 3-tool scenario against Luna's 6.6s. That number was measured at
`TOOL_MAX_TOKENS = 4000` in `scripts/benchmark-bakeoff.ts`: the same budget-starvation trap that
had already invalidated the fast-model conclusions, sitting undiscovered in a second constant.
Re-run at 16,000:

| config | rounds | tools | args valid | finished | wall | cost |
|-|-|-|-|-|-|-|
| `deepseek-v4.1-flash` default | 3 | **3/3** | 3/3 | yes | **2.4s** | $0.001367 |
| `deepseek-v4.1-flash` `low` | 3 | 3/3 | 3/3 | yes | 2.4s | $0.001359 |
| `gpt-5.6-luna` `none` | 3 | 3/3 | 3/3 | yes | 2.7s | $0.000399 |
| `gpt-5.6-luna` default | 3 | 3/3 | 3/3 | yes | 3.2s | $0.000486 |
| `glm-5.3-flash` `high` | 3 | 3/3 | 3/3 | yes | 18.4s | $0.000355 |

**V4.1 Flash is the fastest of the three on a real tool loop**, not 3× the slowest. Every
latency argument this record has made against it is now retracted. `glm-5.3-flash` is 7×
slower here and is not a brain candidate on wall clock, though it is the cheapest.

### What actually decides it now: prompt caching

Per tool loop V4.1 costs 2.8× Luna ($0.001367 vs $0.000486) — 644 output tokens against 156,
i.e. it is simply more verbose. That gap is small. The one that is not small is the cache.

Luna reads cached input at **$0.02/M** and reports 3,152 of 3,155 tokens cached on a warm
identical prefix, dropping a repeat call **9×** to $0.00007. `deepseek-v4.1-flash` reports
`cached_tokens` but the route publishes **no cached-input rate at all**, so a warm call bills
at full input price and stays flat at ~$0.00098 — **14× Luna's cached call**.

A brain is the worst possible shape for that. Hermes runs `context_length: 850000` and
`max_turns: 90`; every turn re-sends the whole conversation prefix. The model that gets a 9×
discount on exactly that prefix wins on economics by a margin no per-loop figure reflects, and
the margin grows with conversation length rather than shrinking.

**Verdict: stay on `gpt-5.6-luna` — on caching economics, not on speed.** The honest statement
of the remaining gap is: V4.1 Flash is slightly faster per tool loop and slightly smarter on
the AA index, and costs multiples more per turn on a long conversation while being unable to
produce a long answer reliably. Re-open the moment IU publishes a cached-input rate for it.

Two smaller facts from the same run, both worth carrying: `deepseek-v4.1-flash` reports
`reasoning_tokens: 0` on this route while billing hidden thinking inside `completion_tokens`,
so any think:visible figure computed from that field is wrong; and Luna at `reasoning_effort:
none` completes the loop 0.5s faster than at default — which is not a reason to use it, since
`none` is a 16.8-index configuration against default's 25.8 (see
[reasoning-effort.md](./reasoning-effort.md)).

## 2026-09-12 (decisive): caching at real context scale — measured, not asserted

The section above kept the brain on Luna on a caching argument that had only been measured at a
**3,155-token** prefix. That is "does caching work", not "does caching decide a brain". Re-run at
**31k tokens**, the scale a real Hermes turn re-sends (`context_length: 850000`, compaction at
240k), three identical calls each:

| model | cold call | **warm call** | cached tokens reported | warm wall | needle answer |
|-|-|-|-|-|-|
| `gpt-5.6-luna` | $0.006254 | **$0.000632** | 31,232 / 31,235 | **491–580ms** | 7041, 7041, 7041 |
| `glm-5.3-flash` @ `high` | $0.004944 | $0.000996 | 32,896 / 32,942 | 1,635–1,828ms | **7419, 7419**, 7041 |
| `deepseek-v4.1-flash` | $0.009447 | **$0.009418** | **0** | 823–1,039ms | 7041, 7041, 7041 |

**`deepseek-v4.1-flash` does no prompt caching on this route at all.** It reports `cached: 0` at
31k tokens — this is not a missing discount rate, it is a missing cache. Its warm call costs the
same as its cold one, **14.9× Luna's warm call**. Across a 90-turn conversation that is roughly
$0.85 against $0.06, and the gap widens with context rather than closing.

**At this scale Luna is also the faster model** — 491ms warm against V4.1's 823ms. The 2.4s
tool-loop advantage V4.1 showed in the section above was measured on a ~1,100-token input; it
does not survive a real prefix. Both halves of the case for V4.1 therefore fail at Hermes's
actual operating point, and they fail for the same reason: everything that made it look good was
measured on inputs far smaller than the ones it would face.

**Incidental, and important elsewhere: `glm-5.3-flash` failed long-context retrieval.** Asked
which port `service-42` uses, with the answer stated verbatim in the prefix, it answered `7419`
twice and `7041` once — at `high` effort. Luna and V4.1 were 3/3. Whatever glm is used for, it
should not be a slot that has to find a specific fact in a large context.

### Verdict

**`gpt-5.6-luna`, and the question is now closed for this workload.** It is the cheapest *and*
the fastest at Hermes's context scale, and the only candidate that is both. Configure it for
capability, not thrift: `agent.reasoning_effort: high` (already set, `config.yaml:77`), no output
cap on the brain, and no thinking budget — the caching economics mean a long, well-reasoned turn
is cheap, so there is nothing to save by constraining it.

**Re-open trigger:** IU exposing a cached-input rate *and* non-zero `cached_tokens` for a DeepSeek
deployment. Until then the comparison is not close, and the re-run that would change it is the
cache suite at 31k, not another tool benchmark.

> **Superseded by §2026-09-13.** The measurements above stand; the verdict does not.

## 2026-09-13: owner decision — `deepseek-v4.1-flash`, capability over cost

The owner moved the brain to `deepseek-v4.1-flash` knowing the 14.9x warm-turn figure above. The
decision prices capability, not thrift: V4.1 tops Luna's ceiling (39.5 vs 37.5 at max effort),
and one model now serves every mid-size lane in the estate (Hermes, research-gateway,
audio-gateway's structural stages, warden's mapper, argo, image-gen enhance), so a future swap
is one id per service rather than a per-slot argument. The ~$0.85 per 90-turn conversation is
accepted as the price of that.

Live probes the same day decided the wiring, not the choice:

| probe | result | consequence |
|-|-|-|
| `deepseek-v4.1-flash` on `/openai/v1/responses` | **404** "No suitable backend" (though `/models` lists Responses) | `api_mode: chat_completions` |
| function tools + `reasoning_effort: high`, auto and forced `tool_choice` | 200, tool called | effort survives tool turns — the transport patch must stop stripping it for non-gpt ids |
| `gpt-5.6-luna` function tools + `reasoning_effort` on `/chat/completions` | **503** "not supported" | the strip stays, scoped to gpt-5.x only; fallback on Luna runs tools without effort |
| `/models` `ContextSize` | V4.1 1,000,000; Luna listed 105,000 but served a 150k Chat prompt | `context_length: 850000` is inside V4.1's window; the Luna fallback keeps it too |

**Re-open trigger:** a monthly Hermes bill that the owner judges out of proportion, or IU
exposing non-zero `cached_tokens` for V4.1 (which only strengthens this pick). The comparison to
re-run on a trigger is the 31k cache suite, not a tool benchmark.

## 2026-09-13 (later): correction — V4.1 does cache, and the price moved

The "no prompt caching" finding above does not hold in production. The first live day of the
brain on `deepseek-v4.1-flash` recorded, from Hermes' own `state.db`:

| session | calls | uncached input | cache read | output | cache share |
|-|-|-|-|-|-|
| 2026-09-12 Slack thread | 52 | 145,090 | 3,996,061 | 69,566 | 96% |
| 2026-09-13 voice-memo turn | 20 | 68,588 | 829,056 | 12,259 | 92% |

Direct probes reproduce it, but not every time: an ~11k identical prefix sent three times at 2s
spacing read 10,880 cached tokens on calls 2 and 3; the same probe at 15s spacing, or three
back-to-back non-streamed calls, read `cached: 0`. The cache is real and 64-token-granular,
but a single probe run can miss it, and that is how the 31k suite above scored zero.
**Re-run the cache suite at least twice, and read real sessions before a zero is believed.**

Rates solved exactly (1e-7 USD residual) from the gateway's `usage.cost`, same day:

| model | input | cached | output |
|-|-|-|-|
| `deepseek-v4.1-flash` | **$0.50** | **$0.05** | **$1.50** |
| `glm-5.3-flash` | $0.15 | $0.03 | $0.50 |

The earlier $0.30 / $1.20 figure no longer matches what the gateway bills. Cache writes carry
no surcharge. `completion_tokens_details.reasoning_tokens` still reads 0, and thinking still
bills inside `completion_tokens`.

At those rates the 52-call thread cost **$0.38** on V4.1 against about $0.19 at Luna's rates for
the same tokens: **~2×, not 14.9×**. The owner decision stands, on firmer ground than it was
taken on.

Wiring verified the same day, after a gateway restart loaded the patched code: `reasoning_effort:
high` and `max_completion_tokens: 65536` reach the wire on every main-loop call, streaming carries
usage, and `reasoning_content` is replayed on each tool round (3- and 9-round tool loops, finish
`stop`). `reasoning_effort` is accepted but produced no measurable change in thinking length
between `low`, `high` and `max` on a hard arithmetic task (1,800–2,850 completion tokens across all
three). Thinking is always on.
