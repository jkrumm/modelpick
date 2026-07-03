# `ca` Launcher — DeepSeek-V4-Pro via the LiteLLM Bridge

**Decision (2026-07-03):** the `ca` shell launcher (`~/SourceRoot/dotfiles/config/zsh/claude.zsh`)
— the non-Max alternative to the personal `c` launcher, which runs Claude Code on the Max
subscription — now routes **exclusively** through the local LiteLLM bridge (LaunchAgent on
`:4000`, config at `dotfiles/config/litellm/config.yaml`) to **DeepSeek-V4-Pro**, hardcoded as
its default `--model`.

## Why `ca` exists

`ca` runs Claude Code out of the same `~/.claude` config dir as `c` — identical skills, hooks,
subagents, and CLAUDE.md — but billed off the Max subscription. That lets Claude Code be used
at work, or to spare Max quota, without losing any of that setup.

## Why DeepSeek-V4-Pro, not real Claude via IU

An earlier iteration of `ca` pointed directly at the IU unified endpoint's native Anthropic
transport (real Claude models, e.g. Opus 4.8). This was abandoned for two reasons:

1. **Defeats the cost-saving purpose.** Real Claude models via IU are still the expensive
   tier — routing `ca` through them undoes the point of having a separate non-Max lane.
2. **Broke usage-tracker billing classification.** `usage-tracker`'s `classifyBilling()`
   heuristic (`src/models.ts`) assumes any `claude-code`-sourced session running a bare
   `claude-*` model (not `-eu`-suffixed) is Max-subscription billed. IU-endpoint-billed
   real-Claude-model usage from that iteration of `ca` was silently misclassified as Max spend.

Switching `ca` to the LiteLLM bridge on DeepSeek-V4-Pro fixed the tracking issue for free:
DeepSeek-V4-Pro doesn't match the `claude-*` heuristic, so usage-tracker's existing
bridge-routed-model dedup logic (already built for sideclaw's `claude_bridge` workers)
correctly classifies it as IU billing and avoids double-counting against the bridge's own
per-request log — no additional tracking code needed.

## Scope — no model-switching mechanism

The bridge's `config.yaml` also maps DeepSeek-V4-Flash, Kimi-K2.6, and two GDPR-resident Claude
fallback aliases (the same catalog behind the worker tier — see
[kimi-bridge.md](./kimi-bridge.md)). `ca` deliberately does **not** support switching between
them via any flag or env var. DeepSeek-V4-Pro is the sole default; changing it means
hand-editing the `--model` default in `claude.zsh` directly.

## Not a residency decision

Unlike the worker-tier and Hermes-brain choices ([kimi-bridge.md](./kimi-bridge.md),
[hermes-brain.md](./hermes-brain.md)), EU/GDPR data residency was explicitly **not** a factor
here. `ca` is a personal interactive Claude Code session, not a personal-data-handling agent
pipeline — the residency constraint that gates Kimi-K2.6 elsewhere doesn't apply to this choice.
