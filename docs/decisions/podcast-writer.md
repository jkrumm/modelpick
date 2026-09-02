# Podcast writer — Opus 5 writes, Fable 5.1 reviews

**Decision (2026-09-02):** audio-gateway's podcast pipeline (`POST /v1/podcasts`, the
"writers' room" in `src/podcast-script.ts`) writes with **`claude-opus-5`** and reviews with
**`claude-fable-5-1`**, both on the IU endpoint. `claude-sonnet-5`, the first default, is out.
No `reasoning_effort` cap on any stage.

## Why

The episode is not latency-bound — a 22-minute show takes 10–25 minutes to produce either way
— and the script *is* the product. Speed and cost were the wrong axes for the first pick.

Evidence, verified 2026-09-02 (research-gateway run over eqbench.com, arena.ai, vendor pricing):

| Model | EQ-Bench Creative Writing v3 (Elo, snapshot 2026-09-01) | LMArena creative writing (Sep 2, 2026) | Output $/M |
|-|-|-|-|
| claude-opus-5 | **#1, 2116** | #10 as `claude-opus-5-high` (1474±8) | 25 |
| kimi-k3 | #2, 2071 | #24 as `kimi-k3-max` | — |
| GLM-5.3 | #3, 2062 | #15 as `glm-5.3-max` | — |
| gpt-5.6-sol | #4, 1964 | #9 as `gpt-5.6-sol-xhigh` (1477±10) | — |
| claude-fable-5 | #6, 1933 | **#1** (1505±9) | 50 (as Fable 5.1) |
| claude-sonnet-5 | not in top 10 | #50 as `claude-sonnet-5-high` | 10 |

The two boards disagree on the winner but agree that Sonnet is not it. Opus 5 writes (story
pass, segments, revisions — the bulk of the tokens); Fable 5.1 sits on the three reviewer seats
(dramaturge, conversation coach, fact & speech editor), where output is small (notes) and
judgement is what the price buys.

## What it costs and what to watch

- ~$4 writer + ~$1 reviewer tokens per 22-minute episode, on top of ~$2 ElevenLabs v3 characters.
- Both Claude models reason invisibly on the heavy prompts (source + outline + draft ≈ 10–25k
  input tokens); the reasoning is counted against `max_completion_tokens`. Budgets in
  `writerBudget()` carry 16k headroom and double on the parse-failure retry. `llm.finish_reason`
  is on every writer span — `length` means the budget, not the model, is the problem.
- Re-pick triggers: an EU-residency requirement for the notes (Opus 5 has no `-eu` variant on
  IU; `claude-opus-4-8-eu` would be the fallback), or Kimi K3 / GLM-5.3 overtaking on the
  Longform board, which measures exactly this task shape (multi-turn, ~1k words per turn).

## Rejected

- **`reasoning_effort: low` on writing stages.** Measured on a revision prompt: 8.7k → 4.8k
  completion tokens for the same text, i.e. real. Rejected on the owner's call: no time
  pressure, and the deliberation is what we pay for.
- **gpt-5.6-luna** (the Hermes brain): fast and EU-resident, but the creative boards don't
  list the Luna variant near the top and the prep-LLM role it plays in TTS is a different job.
