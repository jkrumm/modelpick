# reasoning_effort — what the values mean, and what we are actually running

Researched 2026-09-12 against vendor documentation, after `bun run bench:fast` showed the
effort ladder moving results by more than the model choice did on some tasks.

## First principle: thinking is the quality lever, not overhead

An earlier draft of this record read low effort as a win because the benchmark rewards wall
clock. That is backwards, and it is worth stating before any number below is read.

`gpt-5.6-luna`'s measured intelligence ladder, same weights and same per-token price
throughout: **16.8 non-reasoning · 21.8 low · 25.8 medium · 32.4 high · 34.8 xhigh · 37.5 max**.
Setting `none` does not make Luna a faster Luna — it makes it **less than half the model**.
Any slot that needs judgment must not run at `none`, however good the latency looks.

The benchmark that produced the tables here (`bun run bench:fast`) grades five *deliberately
easy* deterministic tasks. It measures the **minimum effort that clears a floor**, not the
right effort for hard work. Read it as "this much is enough for labelling and extraction",
never as "this much is enough, full stop".

The real question per slot is therefore *what does this task need*, not *how little can we get
away with*. There is exactly one case below where less effort is strictly better — and it is
better because the higher setting buys nothing, not because thinking is bad.

## The two ladders are not the same ladder

| | `gpt-5.6-luna` | `glm-5.3-flash` |
|-|-|-|
| accepted values | `none` `low` `medium` `high` `xhigh` `max` | **`low` `high` `max` only** |
| **default when omitted** | **`medium`** | **`max`** |
| can thinking be disabled? | yes — `none` | **no**, forced on (`thinking.type: disabled` errors) |
| budget field | `max_completion_tokens` (Chat) / `max_output_tokens` (Responses) | `max_tokens` (default 65,536, max 131,072) |
| thinking counts against that budget? | yes | yes |

`medium` is **rejected** by glm-5.3-flash — confirmed by Zhipu's docs and by our own live probe
(non-JSON error body). Its Coding Plan alias table does map `medium`→`high`, but that is a
different interface and must not be read as the API accepting `medium`.

The shared labels do **not** mean the same thing across the two models. glm's `max` is its
default; luna's `max` is its ceiling.

## What that means for what we run today

**2026-09-13 update: this section is closed, not open.** The finding below (glm-5.3-flash
defaulting to its worst setting) is what triggered the estate-wide rollout — every slot that
used to run at an unchosen provider default now sets one deliberately:

- Every **`glm-5.3-flash`** slot controls thinking via `MAX_THINKING_TOKENS`, the only lever
  that reaches this leg (`reasoning_effort` is ignored by the Requesty hop): **8192** for
  agentic/implementation lanes (sideclaw's AGENT tier/`dispatch`, `agent-dispatch`, warden
  investigate/implement), **2048** for classify-shaped lanes (sideclaw's CLASSIFY tier —
  `check`/`overview`/`review_router`). See [claude-code-model.md](./claude-code-model.md).
- Every **`deepseek-v4.1-flash`** slot — Hermes brain/delegation/compression, research-gateway
  lead+worker, warden `propose_mappings`, audio-gateway's outline/editorial/metadata/research
  passes, argo `ai-gateway`, image-gen `enhance` — sends top-level `reasoning_effort: "high"`
  explicitly. See [hermes-brain.md](./hermes-brain.md) §2026-09-13 and
  [model-configs.md](./model-configs.md).
- The remaining **`gpt-5.6-luna`** slots are the small, latency-critical ones this rollout
  deliberately did not move: TTS prep (`low`) and title generation (`low`); the brain fallback
  runs whatever the brain's own effort resolves to.

The history below (why `max` is pathological on `glm-5.3-flash`, and why nobody had chosen a
value) is the argument that produced this outcome, not a live gap anymore.

### `max` is pathological on `glm-5.3-flash`, and `max` is its default

Same 1000-1800 word task, same model, isolating effort from budget:

| effort | max tokens | result | words | **reasoning tokens** | wall |
|-|-|-|-|-|-|
| `low` | 8,000 | pass | 1595 | **16** | 28s |
| `high` | 8,000 | pass | 1535 | **84** | 47s |
| **`default` (= `max`)** | 8,000 | **0 words, 3/3** | — | budget exhausted | — |
| **`default` (= `max`)** | 16,000 | pass | 1477 | **14,874** | **142s** |
| `high` | 16,000 | pass | 1593 | **266** | 31s |

`max` spends **14,874 reasoning tokens — 56× what `high` spends — and produces a slightly
worse document 4.6× slower.** At an 8,000-token budget that same behaviour consumes the entire
allowance and returns nothing at all, three times out of three, which is how this was found.

This is not an argument for less thinking. `high` thinks (266 tokens) and wins. It is an
argument that **this model's default setting is its worst setting**, and every
`glm-5.3-flash` slot in the stack is on it because nobody chose.

## Vendor guidance, by workload

OpenAI publishes a family-level table for the GPT-5.6 line; Zhipu publishes level descriptions
rather than a workload matrix. Mapped onto our slot shapes:

| workload | luna | glm-5.3-flash |
|-|-|-|
| classification, labelling, short extraction | `none` | `low` |
| structured extraction with ambiguity | `low` | `low`, `high` if the schema is large |
| long-form generation | `medium`, higher only if evaluated | `high`, `max` for hard planning |
| tool use / planning | `low` | `low` |
| balanced agentic loop | `medium` | `high` |
| complex agentic workflow | `high` | `max` |

Two cautions the sources are explicit about: higher effort is **not** monotonically better
(ARC Prize measured luna `xhigh` flat against `high`), and a high-effort request can **exhaust
its output budget during hidden thinking and return no visible answer at all** — which is the
starvation failure `bench-fast` reproduced, and which `argo/apps/api/src/lib/ai-sentence.ts:10-24`
had already documented in production against luna.

## Actions this implies

1. **Set `reasoning_effort: high` on glm-5.3-flash slots — the point is to get off `max`, not
   to think less.** `high` matched or beat `max` on output quality at 56x less reasoning spend
   and 4.6x less wall clock, and it is the difference between a long answer and none at a
   normal budget. Use `low` only for genuinely trivial work (labels, single-field extraction).
   Caveat: ccbench's 0.966 over 46 graded agent-loop runs was measured at the `max` default, so
   re-run a coding slot before trusting a changed effort there — agent loops emit many short
   turns, a shape where `max`'s overspend may not bite the same way.
2. **On the short-output luna slots, raise the budget before lowering the effort.** argo
   titling caps at 24 tokens, classification at 64, reading-match at 80 — all far below what
   any thinking needs, so they are one prompt change away from silently returning empty (which
   `argo/apps/api/src/lib/ai-sentence.ts:10-24` already observed in production). `none` would
   fix the starvation and cost 21 points of intelligence ladder; a 2,000-token budget fixes it
   and costs nothing, since unused budget is not billed. Only drop to `none` where the task is
   genuinely mechanical — a fixed-label classifier is; a title that has to read a thread is not.
3. **Trap, hermes specifically: do NOT set `reasoning_effort` on an `auxiliary.*` block.**
   The auxiliary client is a parallel wire path — 16 direct `chat.completions.create` call
   sites in `agent/auxiliary_client.py` — that never traverses the patched
   `ChatCompletionsTransport.build_kwargs`. It folds a configured effort into
   `extra_body["reasoning"]`, and **the IU gateway rejects that shape** with
   `Unknown parameter: 'reasoning'` — `hermes-agent/docs/patches.md` says so in the same
   sentence where it (incorrectly) claims the patch covers "the auxiliaries". It does not.
   Today nothing is set on any aux block, so the two paths agree by both being empty; the
   moment one is set, the call 400s. Correct order: fix the wire shape in the aux client
   first, then set an effort. `patches.md` should also drop "the auxiliaries" from that
   sentence.

4. **Add effort plumbing where it does not exist.** research-gateway has no `providerOptions`
   pass-through (`src/agent/{plan,synthesize,worker}.ts`), audio-gateway's `callPodcastLlm`
   has no effort field (`src/podcast-script.ts:912-930`), argo's `aiComplete` has none
   (`routes/ai.ts:152-182`). Any effort-based recommendation is blocked on that work first —
   it is not a config change.
5. **Never send `medium` to glm-5.3-flash.** Guard it wherever an effort value becomes
   configurable.
