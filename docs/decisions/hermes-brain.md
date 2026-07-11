# Hermes Brain — Sonnet → Kimi-K2.6 → DeepSeek-V4-Pro (GLM-5.2 bake-off, stayed)

**Current:** `DeepSeek-V4-Pro` since 2026-06-02, with fallback `claude-sonnet-4-6-eu` unchanged.
Verified EU-resident (Azure Spain Central) at switch time. A 2026-07 bake-off against GLM-5.2
confirmed DeepSeek-V4-Pro as the right call — closer than expected, but no benefit strong
enough to justify switching a running system.

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

## Verdict

**Stay on DeepSeek-V4-Pro.** Closer than the external leaderboard numbers suggested — GLM-5.2
is a genuine, verified-fast, verified-reliable alternative — but "faster and equally reliable"
isn't "clearly better," and DeepSeek-V4-Pro still leads on quality, cost, context, and has the
only verified residency precedent of the two. No demonstrated benefit strong enough to change
a running, prompt-tuned system. Revisit if GLM-5.2's residency gets independently verified or
its quality gap closes further.

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
