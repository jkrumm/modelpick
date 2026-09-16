# Model-Choice Decision Records

**Start at [../GUIDELINES.md](../GUIDELINES.md)** for the settled patterns — this directory is
the evidence behind them, not the place to start reading. For exact per-model settings and the
gateway-leg map, go straight to [model-configs.md](./model-configs.md).

This directory captures the **rationale** behind the model choices across the personal AI
stack — the "why we picked X over Y," the bake-off verdicts, the residency constraints, and the
non-obvious lessons learned. Every record now opens with a **verdict block** stating its current
answer and whether it has been superseded, so it is safe to read from any point, not just top
to bottom.

The **operational wiring** (config files, ports, launchd plists, keychain commands, secret
references, deployment) lives in the `dotfiles` repo and is intentionally *not* duplicated here.
These records answer *why*; dotfiles answers *how*.

## Philosophy

Every model choice is a three-way tradeoff between **capability**, **cost at the slot's real
operating point**, and **operational fitness**. None dominates universally.

- **Capability** — does the model actually do the job? Verdicts come from live bake-offs
  (dense-diagram reading, blind TTS listening tests, graded agent loops), not from spec sheets
  or vendor benchmarks. And *thinking is the capability lever*: an effort setting moves a model
  further than swapping it for a neighbour usually does.
- **Cost at the real operating point** — not the rate card. Prompt caching moves a turn's cost
  by an order of magnitude, so price the slot's real prefix and hit rate. One cache probe that
  read zero for `deepseek-v4.1-flash` put it at 14.9× Luna; its real sessions, 92–96% cached,
  came out ~2×.
- **Operational fitness** — which gateway leg serves it (Claude Code can only reach
  `claude-*`, `glm-5.3-flash`, `minimax-m3`), whether it starves under the slot's token budget,
  whether its thinking spend is predictable, whether it can hold a tool loop. This is where most
  picks are actually decided, and none of it appears on a leaderboard.

**Data residency is no longer a governing axis here.** It is recorded where a record's history
turned on it, and the live `capability_probe.residency` reading is still collected, but it is not
a per-slot gate and no longer flags anything on `/stack`.

Two cross-cutting principles:

- **The IU unified endpoint is the substrate.** A single OpenAI-compatible / Anthropic / Gemini /
  Replicate gateway fronts dozens of backends behind one key. Most model choices reduce to
  *picking the right alias on that endpoint* rather than integrating a new vendor.
- **Listed ≠ callable.** The catalog lists far more models than reliably serve real traffic.
  Every choice here is backed by a live completion that returned real output, not a `/models`
  listing.

## Records

Where the running config lives: the `deployment` table (`src/db/deployments.ts`, section 1 of
`/stack`) answers *which slot runs it today*; `bun run verify-deployments` checks that against
the actual config files. One line per record below — filename, the question it answers, its
current verdict clause:

- [hermes-brain.md](./hermes-brain.md) — which model runs the Hermes personal-data brain →
  `deepseek-v4.1-flash` at `reasoning_effort: high`, an owner decision for capability over the
  measured caching cost.
- [fast-model.md](./fast-model.md) — the `fast` category pick → `deepseek-v4.1-flash` (owner
  decision, 2026-09-13); the recommender still names `gpt-5.6-luna`.
- [claude-code-model.md](./claude-code-model.md) — which model drives Claude Code on the IU
  Anthropic route → `claude-sonnet-5` interactive, `glm-5.3-flash` unattended, `claude-opus-5`
  EU-pinned.
- [coding-model.md](./coding-model.md) — stub, superseded by claude-code-model.md; kept for the
  DeepSeek Pro→Flash coding-index history.
- [vision-and-image.md](./vision-and-image.md) — diagram/screenshot reading + image generation →
  `gemini-3.5-flash` holds for reading, `gpt-image-2` for generation.
- [writing-model.md](./writing-model.md) — the `writing` category pick → `claude-opus-4-6`
  holds, explicitly under-evidenced for German.
- [audio-stack.md](./audio-stack.md) — cloud TTS + STT → ElevenLabs via Replicate for TTS,
  `gpt-4o-transcribe` for STT with `whisper` for EU/diarization gaps.
- [iu-vs-ai-studio.md](./iu-vs-ai-studio.md) — IU gateway vs a personal Google AI Studio key →
  stay on IU; AI Studio only as a control.
- [gemini-tool-calling-shapes.md](./gemini-tool-calling-shapes.md) — does the Hermes-brain
  verdict on Gemini transfer to other services → no, it inverts for single-shot forced-tool
  calls.
- [execution-modes.md](./execution-modes.md) — where agent work runs (inline / subagent / MCP /
  subprocess / research-gateway) → the rationale behind dotfiles' operational routing table.
- [sideclaw-tiers.md](./sideclaw-tiers.md) — sideclaw's six routing tiers → CLASSIFY/AGENT/VISION
  scored (`coding`, `coding`, `vision`), JUDGE/PROSE/adversary structural; AGENT (`dispatch`)
  split off CLASSIFY on 2026-09-13.
- [podcast-writer.md](./podcast-writer.md) — which model writes/reviews/researches the podcast →
  role split, `claude-opus-4-6` as the sole voice owner, `deepseek-v4.1-flash` on every other
  structural role.
- [model-configs.md](./model-configs.md) — the rollout reference: exact per-model settings,
  which gateway leg serves what, and the gateway-wide traps.
- [reasoning-effort.md](./reasoning-effort.md) — the two effort ladders and what they cost →
  closed as of the 2026-09-13 rollout: every slot now sets one deliberately.
