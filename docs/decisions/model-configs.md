# Model configs — the exact settings, per model, per wire

The rollout reference. Every line here is either vendor-documented or live-probed against the
IU gateway on 2026-09-12. Rationale lives in [reasoning-effort.md](./reasoning-effort.md),
[fast-model.md](./fast-model.md) and [hermes-brain.md](./hermes-brain.md); this file is the
settings themselves.

**Read [reasoning-effort.md § First principle](./reasoning-effort.md) before applying any of
it.** Thinking is the quality lever. Nothing below is an argument for less of it — the one
place we lower a setting, we lower it because the higher setting demonstrably buys nothing.

## Which leg serves what (live-probed)

The gateway has two legs and they do not serve the same models. **Claude Code — and therefore
every sideclaw `session` tool, `agent-dispatch`, and every warden episode — can only use a
model served on the Anthropic leg.**

| model | `/openai/v1` | `/anthropic/v1` (= Claude Code) |
|-|-|-|
| `gpt-5.6-luna` | 200 | **404** |
| `deepseek-v4.1-flash` | 200 | **404** |
| `gemini-3.8-flash` | 200 | **404** |
| `glm-5.3-flash` | 200 | 200 |
| `minimax-m3` | 200 | 200 |

So the entire "should we move X to DeepSeek/Luna" question is **structurally closed** for any
Claude Code lane: neither model is reachable there. The Claude Code candidate set is
`claude-*`, `glm-5.3-flash`, `minimax-m3`.

## `gpt-5.6-luna`

| | |
|-|-|
| legs | OpenAI only |
| context | `/models` lists 105,000, but a 150,011-token Chat prompt returned 200 (2026-09-13) — the listed figure is not the limit |
| effort param | `reasoning_effort` top-level (Chat) · `reasoning.effort` (Responses) |
| values | `none low medium high xhigh max` — **default `medium`** |
| budget param | **`max_completion_tokens`** (Chat) · `max_output_tokens` (Responses) |
| thinking billed against budget | yes |
| intelligence by effort | 16.8 / 21.8 / 25.8 / 32.4 / 34.8 / 37.5 |
| price | $0.20 in · $0.02 cached · $1.20 out |

- **Never `none` on anything requiring judgment** — it is a 16.8-index model there.
- **Minimum budget ~2,000** on any slot with thinking. Below that it returns HTTP 200 with
  `finish_reason: length` and an **empty** message — no error, no exception. Observed in argo
  production (`apps/api/src/lib/ai-sentence.ts:10-24`), not just in our bench.
- `max_tokens` is deprecated for this model; the IU gateway 503s with
  `Use 'max_completion_tokens' instead`.
- **Do not send an explicit `temperature`** — the gateway 503s with
  `Only the default (1) value is supported`.
- **Function tools + `reasoning_effort` on `/chat/completions` → 503** (`Function tools with
  reasoning_effort are not supported`, probed 2026-09-13). A Chat tool loop on Luna runs without
  effort; for effort in a tool loop use Responses.
- **Do not use the `extra_body: {"reasoning": …}` shape** — rejected with
  `Unknown parameter: 'reasoning'`. The effort goes on the wire **top-level**.

## `glm-5.3-flash`

| | |
|-|-|
| legs | **both** |
| effort param (OpenAI leg) | `reasoning_effort` |
| values | **`low high max` only — `medium` is REJECTED** (non-JSON error body). Default **`max`** |
| thinking param (Anthropic leg) | `thinking: {type: "enabled", budget_tokens: N}` |
| budget param | `max_tokens` (vendor default 65,536, max 131,072) |
| can thinking be disabled? | **no** — forced on |
| price | $0.15 in · $0.03 cached · $0.50 out |

**Set `reasoning_effort: high`. Do not leave it at the `max` default.** Measured on a
1000–1800 word task:

| effort | budget | result | reasoning tokens | wall |
|-|-|-|-|-|
| `low` | 8,000 | pass, 1595 words | 16 | 28s |
| `high` | 8,000 | pass, 1535 words | 84 | 47s |
| `max` (default) | 8,000 | **0 words, 3 of 3** | budget exhausted | — |
| `max` (default) | 16,000 | pass, 1477 words | **14,874** | **142s** |
| `high` | 16,000 | pass, 1593 words | 266 | 31s |

`max` spends 56× the reasoning of `high` for a slightly worse document, 4.6× slower — and at a
normal budget it returns nothing. Use `low` only for genuinely trivial work (fixed-label
classification, single-field extraction).

**Long-context caveat:** asked to find a fact stated verbatim in a 31k-token prefix, it answered
wrongly 2 of 3 times at `high` effort, where `gpt-5.6-luna` and `deepseek-v4.1-flash` were both
3/3. Do not put it on a slot that must retrieve a specific detail from a large context. It does
cache correctly (32,896 of 32,942 tokens, $0.000996 warm).

**On the Anthropic leg (Claude Code) two traps:**

```
thinking: {type: "disabled"}                  → ACCEPTED AND IGNORED. Still emits a thinking
                                                 block, and spent MORE than sending nothing
                                                 (133 vs 49 output tokens on the same prompt).
thinking: {type:"enabled", budget_tokens:1024} → works. 3 output tokens vs 49. 6.7x cheaper.
```

Claude Code's `MAX_THINKING_TOKENS` maps to `budget_tokens` and is therefore **the only working
thinking control on that leg**. Run values: **8192** on agentic lanes (sideclaw `dispatch`,
`agent-dispatch`, `ca glm-5.3-flash`), **2048** on classify lanes (sideclaw `check`, `overview`,
`review_router`) — 2048 is the ccbench-measured cap, 8192 gives implementation work headroom
now that no wall clock punishes a longer think. Pair it with `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000` and all
four `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` pinned to the same id, plus
`API_TIMEOUT_MS=3000000` (this model's honest time on hard agentic work is minutes per turn —
budget on **idle**, never wall clock).

## `deepseek-v4.1-flash`

| | |
|-|-|
| legs | OpenAI **`/chat/completions` only** — **cannot drive Claude Code**; `/responses` 404s although `/models` lists it |
| context (`/models` ContextSize) | 1,000,000 |
| effort | `reasoning_effort`, honoured; accepts `low high xhigh max`. **We run `high`** |
| budget | `max_completion_tokens` — ≥16,000 normal, ≥32,000 when the output is a long report or tool-argument document |
| tools | function tools **with** `reasoning_effort`, `tool_choice` auto and forced — 200 |
| structured output | `response_format: {type: "json_object"}` — 200 |
| price | $0.50 in · $0.05 cached · $1.50 out (solved from `usage.cost`, 2026-09-13). Cache writes carry no surcharge |

- **Fastest to a short correct answer in the field**: 668ms median, 658 tok/s decode, crossover
  against Luna at **84 visible tokens**.
- **Cannot be trusted with long output.** Starved or truncated on 5 of 6 long-generation
  attempts at an 8,000-token budget. Its thinking expands to fill whatever it is given —
  273 completion tokens for a 94-character answer at a 4k cap, 2,191 for the *same answer* at
  16k; think spread ~7,970 tokens in every measured cell.
- **`completion_tokens_details.reasoning_tokens` is misreported as `0`** on this route while
  hidden thinking is billed inside `completion_tokens`. Infer the split the way
  `scripts/benchmark-bakeoff.ts` does, or every think:visible figure will be wrong.
- **Prompt caching works, but a single probe can miss it.** A 31k probe once read `cached_tokens: 0`
  on all three calls; live Hermes sessions read 92–96% of input from cache, and an 11k probe at 2s
  spacing hit on calls 2–3. Run a cache probe twice before believing a zero. A warm Hermes turn is
  ~2× Luna's cost, not 14.9× ([hermes-brain.md](hermes-brain.md) §2026-09-13 correction).
- **Hard floor ~1,000 tokens.** Below it: `finish_reason: length`, zero visible output.

## `gemini-3.8-flash`

| | |
|-|-|
| legs | OpenAI only |
| price | **$0.75 / $3.75 — $0.020–0.031 per bench run, 6–9× the field** |

Passes 4/5 at every effort once graded fairly. Its one reproducible miss: it **overshoots an
explicitly stated word range 6 times out of 6** (2,863–3,600 tokens against an 1,800-word
ceiling). Cost is the decisive argument against it for fast-tier work; it remains a live
candidate for writing, where this benchmark is not evidence.

## `minimax-m3`

Both legs. 5/5 at `low`/`medium`/`high`/`default`, but 1.9–2.9s median wall, $0.008–0.012 per
run, and a ~7,000-token think spread with intermittent starvation. Only reason to reach for it:
it is one of just two non-Claude ids that can drive Claude Code.

## Gateway-wide traps (apply to every model)

1. **`max_completion_tokens`, never `max_tokens`** on the OpenAI leg — 503 otherwise.
2. **Never send an explicit `temperature`** — 503, `Only the default (1) value is supported`.
   `sideclaw/server/lib/iu-openai.ts`'s `visionRead` no longer hardcodes `temperature: 0` — the
   hardcode was removed (the module comment now reads "`temperature` is never sent"), closing
   the trap this bullet used to warn about there.
3. **Effort goes top-level, never `extra_body: {"reasoning": …}`** — the latter is rejected.
   `hermes-agent`'s auxiliary lanes (`agent/auxiliary_client.py`, which builds its own kwargs
   outside the main `ChatCompletionsTransport`) are now covered: `patches/
   transport-iu-reasoning-effort.patch` reconciles top-level `reasoning_effort` against what
   each model family accepts on the IU leg, and `patches/
   auxiliary-client-iu-openai-leg-quirks.patch` mirrors the same host check to omit
   `temperature` for gpt-5.x there. `compression` and `title_generation` both set
   `reasoning_effort` in `config.yaml` as of the 2026-09-13 rollout without hitting the old
   400 — the gap this bullet used to flag is closed.
4. **Unused budget is not billed.** Raising a cap costs nothing and prevents silent empty
   responses; lowering effort costs intelligence. When a slot returns empty, raise the budget
   before touching the effort.
5. **Every one of these failures is silent.** Empty content arrives as HTTP 200. Every call
   site should assert non-empty content and log `finish_reason`.
