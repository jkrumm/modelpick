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
- **Data residency** — anything touching personal data (calendar, health, email, recorded
  voice) must stay EU/GDPR-resident. This hard-gates model selection regardless of
  capability or cost.

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
- [hermes-brain.md](./hermes-brain.md) — Hermes Sonnet → Kimi-K2.6 brain switch and the
  EU-safe fallback (deliberately *not* Kimi-K2.5, which routes US).
- [execution-modes.md](./execution-modes.md) — the orchestrator execution-mode framework
  (inline / subprocess / MCP / fork), model tiers, and "never switch the orchestrator model
  mid-session."
