# agent-workflows text seats — the GPT stack by effort

> **Current verdict (2026-10-30):** agent-workflows runs its text routes on four seats, chosen once in
> `packages/routes/src/table/_shared.ts`: **TRIVIAL** `gpt-6-luna` low, **EASY** `gpt-6.1-terra` low, **STRONG**
> `gpt-6.1-terra` medium, **CHEAP** `deepseek-v4.1-flash` (research, otel, cross-lab reviewers, the GPT routes' balance
> fallback). `claude-haiku-5-5` stays for the private vault (`brain.agent`) and as the balance fallback of the four routes
> owner-directed off Requesty. Owner decision; the evidence below.
> **Status of this record:** current

## Artificial Analysis, Intelligence Index v5.0 (read 2026-10-30)

Do not mix index versions: v4.x scored Haiku 5.5 at 43 and Luna at 38; v5.0 (27 Oct) says 36 and 28.

| Model, effort | Index | Cost per index task | First answer token |
|-|-|-|-|
| Terra max | 51 | $0.96 | 233 s |
| Terra high / medium / low / none | 42 / **38** / 29 / 30 | n/a / $0.17 / $0.07 / n/a | n/a / 2.6 s / n/a / 1.0 s |
| Haiku 5.5 max / medium / low | 36 / 25 / 19 | $0.41 / $0.09 / $0.04 | 327 s / 10 s / 7.8 s |
| DeepSeek V4.1 Flash (max, the only variant listed) | 32 | $0.60 | 12.5 s |
| Luna max / medium / low / none | 28 / 18 / 10 / 9 | $0.15 / $0.04 / $0.01 / n/a | 89 s / n/a / n/a / 0.9 s |

Terra medium is the efficiency knee (+13 points to max for 5.6x the cost). Luna below medium is nearly free and
nearly useless (10 against Terra low's 29). The agentic knowledge-work rows (AA-Briefcase Elo) favour Haiku 1576 and
DeepSeek 1570 over Terra 1402, which is why research and otel stay on DeepSeek until measured.

## Paired review eval (agw `eval run review`, 12 recorded cases, same scorer, 2026-10-30)

| Arm | Depth | Verdict agreement | Recall | Cost per review |
|-|-|-|-|-|
| Haiku 5.5 (default effort) | deep | 0.17 | 0.05 | $0.035 |
| DeepSeek flash (default) | deep | 0.67 | 0.05 | $0.48 (176M input tokens) |
| Terra medium | deep | 0.67 | 0.00 | $0.42 (14M input tokens) |
| Haiku 5.5 | standard | 0.08 | 0 | $0.043 |
| Terra medium | standard | **0.58** | 0 | $0.289 |

Terra medium against DeepSeek: a tie on every quality metric, cheaper and 13x fewer tokens. Terra medium against Haiku
at standard depth: verdict agreement 0.58 against 0.08, CI of the difference [0.25, 0.75], at 6.7x the cost. Recall and
precision are too sparse at n=12 to separate any arm; Sonnet 5.5 reached recall 0.13 in the Oct 28 run.

## Constraints that shaped the seats

- **Requesty:** DeepSeek flash is a Requesty-hosted model; the four routes owner-directed off it (`cheap.classify`,
  `review.router`, `review.ocr`, `review.adversary`) fall back to Haiku on the chat wire, `triage` has no fallback.
- **Vendor split on balance failure:** GPT routes fall back to DeepSeek, DeepSeek routes to Terra; OpenAI's balance is
  not DeepSeek's.
- **Residency:** Terra answers from AWS us-east-1 (probed 2026-10-29). The private vault stays on Haiku's EU leg.
- **Spend:** Haiku's 7-day production spend was about $17, nearly all review angles; Terra medium puts that near $115.
