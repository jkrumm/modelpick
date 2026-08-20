# Model-Choice Decision Records

This directory captures the **rationale** behind the model choices across the personal
AI stack — the "why we picked X over Y," the bake-off verdicts, the residency
constraints, and the non-obvious lessons learned. It is the evidence layer.

The **operational wiring** (config files, ports, launchd plists, keychain commands,
secret references, deployment) lives in the `dotfiles` repo and is intentionally
*not* duplicated here. These records answer *why*; dotfiles answers *how*.

## Philosophy

Every model choice is a three-way tradeoff between **capability**, **cost**, and **data
residency**. None of the three dominates universally — the right answer depends on the
work.

- **Capability** — does the model actually do the job? Verdicts come from live bake-offs
  (dense-diagram reading, blind TTS listening tests), not from spec sheets or vendor
  benchmarks.
- **Cost** — Anthropic Max quota is the scarcest resource; IU per-token billing and local
  inference are effectively free for the volumes involved. Work is pushed off Max wherever
  capability allows.
- **Data residency** — one input into model selection where personal data (calendar, health,
  email, recorded voice) is involved, weighed alongside capability and cost rather than an
  absolute override. It matters more when a residency-verified alternative is otherwise
  equivalent; it doesn't by itself disqualify a model that's clearly better on capability/cost
  (see [hermes-brain.md](./hermes-brain.md) for how this played out in practice).

Two cross-cutting principles:

- **The IU unified endpoint is the substrate.** A single OpenAI-compatible / Anthropic /
  Gemini / Replicate gateway fronts dozens of backends behind one key. Most model choices
  reduce to *picking the right alias on that endpoint* rather than integrating a new vendor.
- **Listed ≠ callable.** The catalog lists far more models than reliably serve real traffic.
  A model id appearing in `/models` proves nothing — every choice here is backed by a live
  completion that returned real output. Aliases also differ in backend redundancy
  (`backends=N`): more backends means fewer 429s and timeouts, so reliability is part of the
  selection, not an afterthought.

## Records

- [audio-stack.md](./audio-stack.md) — cloud TTS (`gemini-3.1-flash-tts-preview`, Charon) + STT
  (`gpt-4o-transcribe`, EU `whisper` fallback) on the IU endpoint via audio-gateway (VPS
  container; audio-proxy retired 2026-06-17); why the local Fish/Parakeet stack was retired; the
  chunking / long-generation-drift carryover.
- [kimi-bridge.md](./kimi-bridge.md) — why Kimi-K2.6 is the EU/GDPR worker model, the
  non-obvious LiteLLM bridge fixes as lessons learned, fallback to `claude-sonnet-4-6-eu`.
- [vision-and-image.md](./vision-and-image.md) — `gemini-3-pro-preview` for dense diagrams
  (bake-off result), `gpt-image-2` for generation, the EU/US residency table, the
  "stateless HTTP call vs multi-step agent loop" placement insight.
- [hermes-brain.md](./hermes-brain.md) — Hermes brain history (Sonnet → Kimi-K2.6 →
  DeepSeek-V4-Pro → DeepSeek-V4-Flash): the 2026-07-11 live bake-off against GLM-5.2 and the
  refreshed catalog (the `benchmark`/`benchmark:tools` live-metric scripts, why Pro stayed
  despite GLM-5.2 measuring faster, why Qwen3.7-Max/Kimi-K2.7-Code failed on tool-calling),
  then the 2026-07-31 switch to Flash after the `-0731` re-post-training — what it wins
  (index, cost, time-to-first-token), what it gives up (factual recall), and the two things
  that could not be verified; the 2026-08-10 switch to `gpt-5.6-luna` on latency + Sweden
  Central residency; and the 2026-08-20 `gemini-3.7-flash` bake-off — why IU's `/gemini` native
  route has no EU path for it (the `iu-ai-6123` / `europe-west1` 404 that proves it), why 4.7×
  slower TTFT beats 4× faster decode for a Slack agent, and the 8–10× cost gap.
- [fast-model.md](./fast-model.md) — why `DeepSeek-V4-Flash` holds the fast pick against a
  GLM-5.2 recommendation: AA overstated GLM's throughput by 3.8× (37.7 tok/s measured live),
  GLM reports no TTFT at all, and it costs 3.75–15× more. Also records the scoring defect this
  exposed — live `ttft_ms` was collected and never read by the scorer.
- [coding-model.md](./coding-model.md) — why the coding pick moved from `DeepSeek-V4-Pro` to
  `DeepSeek-V4-Flash` on 2026-08-02: the AA coding index flipped 69.1 vs 59.4 while Pro sat
  unchanged since April, the agentic-coding sweep (Terminal-Bench, DeepSWE, NL2Repo) that
  matters for `ca`/`claude_bridge`/opencode, and what Pro keeps (long-context retrieval, the
  only SWE-bench Verified score).
- [execution-modes.md](./execution-modes.md) — the orchestrator execution-mode framework
  (inline / subprocess / MCP / fork), model tiers, and "never switch the orchestrator model
  mid-session."
- [ca-launcher.md](./ca-launcher.md) — why the `ca` non-Max launcher routes through the
  LiteLLM bridge to DeepSeek-V4-Pro, the abandoned direct-IU-Anthropic iteration and the
  usage-tracker billing-misclassification bug it caused, and the deliberate no-model-switching
  scope.
