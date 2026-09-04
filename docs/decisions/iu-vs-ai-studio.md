# The IU gateway vs Google AI Studio, and where each tier actually lands

**Verdict:** keep going through IU for Gemini. The personal AI Studio key is a **free-tier**
key — Gemini 3.1 Pro is hard-blocked on it (`limit: 0`), and the Flash tiers return
`503 high demand` under any sustained load. IU never refused a single call across the same
runs. AI Studio stays useful as a **control**: it is the only way to tell whether a slow
Gemini response is the model or IU's routing, and on that question IU came out clean.

Measured 2026-09-04 with `bun run scripts/benchmark-crossprovider.ts`, 3 passes per target,
one ~350-word generation, streamed. TTFT is time to the first **visible** token — a thought
part is not something a reader sees, so counting it would make a thinking model look fast.

## The door question

Same model id, same request, both doors:

| Model | TTFT IU | TTFT AI Studio | Wall IU | Wall AI Studio |
|-|-|-|-|-|
| `gemini-3.7-flash` | **4948ms** | 5494ms / 28220ms | 6.5s | 7.1s / 29.5s |
| `gemini-3.6-flash` | **10086ms** | 31337ms / 66716ms | 11.8s | 33.6s / 68.6s |
| `gemini-3.5-flash` | **9733ms** | 12985ms / 13171ms | 11.3s | 14.8s / 14.9s |
| `gemini-3.5-flash-lite` | **605ms** | 648ms / 22869ms | 2.2s | 2.2s / 24.3s |
| `gemini-3.1-flash-lite` | **868ms** | 1739ms / 2405ms | 2.5s | 3.6s / 4.4s |
| `gemini-3.1-pro-preview` | 13472ms | **429, hard-blocked** | 16.4s | — |
| `gemini-3.8-flash` | 6235ms | **503, both runs** | 7.8s | — |

Two AI Studio figures per row because two independent runs disagreed by up to 35x on the same
model — that spread *is* the finding. `gemini-3.5-flash-lite` measured 648ms in one run and
22869ms in the next. IU's numbers moved by single-digit percent over the same interval.

The Pro refusal is explicit and not transient:

```
Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro
```

**So the gateway is not the bottleneck.** Where AI Studio answered at all, IU matched or beat
it, and IU is the only door that reliably answers. The residency picture is unchanged and
still the real constraint: no Gemini tier returns an `x-ms-region` header on either door, and
only `gemini-3.5-flash-eu` / `gemini-2.5-pro-eu` have EU aliases at all.

## Where the tiers land

### Google — Flash-Lite is the surprise

| Model | Tier | TTFT | tok/s | Wall | Visible + thinking | AA intel | $/1M in→out |
|-|-|-|-|-|-|-|-|
| Gemini 3.5 Flash-Lite | Flash-Lite | **605ms** | 229 | **2.2s** | 363 + **0** | 37.4 | $0.30 → $2.50 |
| Gemini 3.1 Flash-Lite | Flash-Lite | 868ms | 255 | 2.5s | 432 + **0** | 25.6 | $0.25 → $1.50 |
| Gemini 3.7 Flash | Flash | 4948ms | 291 | 6.5s | 411 + 973 | 56.0 | $0.75 → $3.75 |
| Gemini 3.8 Flash | Flash | 6235ms | 260 | 7.8s | 456 + 1063 | **58.7** | $0.75 → $3.75 |
| Gemini 3.5 Flash | Flash | 9733ms | 232 | 11.3s | 401 + 1494 | 52.0 | $1.50 → $9.00 |
| Gemini 3.6 Flash | Flash | 10086ms | 245 | 11.8s | 418 + 1437 | 51.6 | $0.75 → $3.75 |
| Gemini 3.1 Pro | Pro | 13472ms | 149 | 16.4s | 433 + 1283 | 47.7 | $2.00 → $12.00 |

The Flash tier's whole TTFT budget is thinking: 1000–1500 hidden tokens before the first
visible one, on a prompt that asked for 350 words of prose. Flash-Lite emits **zero** thinking
tokens and answers in a fifth of the time for a quarter of the cost. If a job doesn't need the
index points, Flash-Lite is not a downgrade — it is a different latency class.

**Gemini 3.1 Pro scores *below* 3.8 Flash on AA's intelligence index (47.7 vs 58.7) while
costing 2.7x more per output token and being twice as slow.** Nothing here justifies reaching
for Pro. Also note AA's own price for 3.5 Flash ($1.50/$9.00) is double the 3.6/3.7/3.8 line —
the newer Flash models are both better and cheaper than the one they replaced.

### OpenAI — Luna is still the fastest thing on the endpoint

| Model | TTFT | tok/s | Wall | Visible + thinking | AA intel | $/1M in→out | Region |
|-|-|-|-|-|-|-|-|
| GPT-5.6 Luna | **449ms** | 94 | 6.0s | 517 + 0 | 52.3 | $0.20 → $1.20 | Sweden Central |
| GPT-5.4 Nano | 689ms | 119 | 4.7s | 496 + 0 | 39.7 | $0.20 → $1.25 | Sweden Central |
| GPT-5.4 Mini | 902ms | 177 | **3.5s** | 506 + 0 | 40.9 | $0.75 → $4.50 | Sweden Central |
| GPT-5.6 Terra | 1441ms | 92 | 8.5s | 648 + 73 | 56.6 | $2.00 → $12.00 | Sweden Central |
| GPT-5.6 Sol | 2356ms | 64 | 11.1s | 608 + 87 | **60.9** | $4.00 → $20.00 | Sweden Central |
| GPT-5.5 | 2839ms | 26 | 24.5s | 572 + 26 | 56.3 | $5.00 → $30.00 | Sweden Central |

449ms TTFT is the best measured number in the entire set, and it is the only family that
verifies `Sweden Central` on every call. That combination is why Luna holds the Hermes brain
([hermes-brain.md](./hermes-brain.md)) and it is not close.

`gpt-5.6-sol` is the quality ceiling here (AA 60.9, above every Gemini and every open-weight
model measured) but at 5.2x Luna's TTFT and 20x its output price. **Sol also carries the one
price disagreement worth knowing about: AA lists $4.00/$20.00, OpenRouter lists exactly half,
$2.00/$10.00.** Neither is IU's billed rate, which IU does not publish.

### Open-weight — good models behind a wall of thinking

| Model | TTFT | tok/s | Wall | Visible + thinking | AA intel | $/1M in→out |
|-|-|-|-|-|-|-|
| GPT-OSS 120B | **771ms** | 302 | **3.0s** | 661 + 0 | 24.1 | $0.15 → $0.60 |
| DeepSeek V4 Flash | 2598ms | 155 | 7.0s | 687 + 212 | 51.8 | $0.44 → $1.32 |
| DeepSeek V4 Pro | 12283ms | 234 | 16.8s | 1064 + 695 | 53.2 | $1.32 → $3.96 |
| Qwen 3.5 397B | 36875ms | 448 | 54.7s | 8000 (cap) + 0 | 34.3 | $0.60 → $3.60 |
| Qwen 3.8 Max | 41499ms | 332 | 48.9s | 2449 + 2021 | 58.1 | $2.00 → $6.00 |
| Kimi K3 | 62966ms | 249 | 73.9s | 2718 + 2246 | **59.7** | $3.00 → $15.00 |
| GLM 5.3 | 65254ms | 296 | 74.0s | 2593 + 2131 | 59.5 | $1.40 → $4.40 |
| GLM 5.3 Flash | 72208ms | 665 | 78.2s | 3988 + 3503 | 57.5 | $0.15 → $0.50 |

The quality is real — GLM 5.3, Kimi K3 and Qwen 3.8 Max all beat every Gemini on AA's index —
but **63–72 seconds to the first visible token disqualifies all three from anything
interactive.** A separate stream probe on a trivial counting prompt returned first chunks in
0.7–9.4s for the same models, so this is the models' own reasoning budget, not IU stalling the
connection. GLM 5.3 Flash spent 3503 hidden tokens on a 350-word essay.

That is consistent with `cap` picking `glm-5.3-flash` as the **unattended worker** and never as
the interactive model. For interactive open-weight, DeepSeek V4 Flash (2.6s) is the only real
candidate, and GPT-OSS 120B is the latency floor at the cost of half the intelligence index.

## Measurement notes worth keeping

- **Give every model a real output budget.** At `maxOutputTokens: 1200` the first run produced
  46 visible tokens from Gemini 3.1 Pro — the budget went to thinking and the "answer" was a
  stub, which then reports a flattering decode rate over tokens nobody asked for. Same trap
  that faked a tool-calling failure in [gemini-tool-calling-shapes.md](./gemini-tool-calling-shapes.md).
- **Don't take a median of per-pass ratios.** One pass whose first visible token lands near the
  end leaves a near-zero decode window and an absurd tok/s that a median over ratios will
  happily promote — an early version of this table claimed 2317 tok/s for Qwen 3.5. Derive the
  rate from aggregated tokens and aggregated time instead.
- **AA's throughput and TTFT columns are AA's own numbers, not measurements.** They are not in
  the tables above for exactly that reason; this repo has already found them off by 3.8x
  ([fast-model.md](./fast-model.md)). Only AA's intelligence index is quoted here.
- **DeepSeek's unsuffixed id resolves to a different dated release on AA than on OpenRouter**
  (AA `deepseek-v4-flash` = 0731 at $0.44/$1.32; OpenRouter's = 0423 at $0.089/$0.177). Joining
  the two sources by canon-matched id silently compares different model builds. Pin the dated
  slug for DeepSeek rather than trusting the bare match.
