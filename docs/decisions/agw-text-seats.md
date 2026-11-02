# agent-workflows text seats — Claude tiers, measured

> **Current verdict (2026-11-02, agent-workflows Wave 6):** every agw text and agent seat is a Claude tier, chosen once
> in `packages/routes/src/table/_shared.ts` and paid from the Claude subscriptions' API credit through the local
> inference gateway; each falls back onto GPT on IU, never onto IU's Claude. **FAST** Haiku 5.5 effort none (titles,
> classify, `diagram.agent`), **EASY** Haiku 5.5 high (summaries, triage, `review.router`, `review.angle`, `check`,
> `brain.agent`, `podcast.metadata`, `otel.agent`), **HARD** Sonnet 5.5 medium (`research.agent`, `review.angle.deep`,
> `review.synthesis`, `prose.write`, `narrative`, `retro.analyze`, the podcast writers' room), **DECIDE** `decision-1`
> (IU decision API; also the eval judge). Reviewers of Claude-written output stay on another lab: `prose.review`
> DeepSeek flash, `review.adversary` and `podcast.review.b` Terra medium, `podcast.review.a` Gemini flash. No seat runs
> Opus: no arm showed it beating Sonnet beyond the CI. Owner decisions (2026-11-01 seats onto Claude, 2026-11-02 measured
> picks, the `review.angle` cost hotfix and `otel.agent` onto Haiku high for cost); evidence in the 2026-11-02 section below and in agent-workflows
> `docs/evals/2026-11-02-claude-seats.md`.
> **Re-open when:** Wave 11's review v2 sweep sets the review seats; a seat's eval suite grows past 30 cases or gains a
> scorer that separates arms; the credit runs out before the month does (then cost counts in the pick); a new Claude
> or GPT generation lands.
> **Status of this record:** current. The sections from "Artificial Analysis" to the 2026-10-31 addendum are
> **superseded** (the GPT stack of 2026-10-30); they stay as history.

## 2026-11-02: the seats measured (agent-workflows Wave 6)

Arms on agw's own eval suites with run-scoped route patches, purpose `eval`, on the `me` credit pool under the
gateway's pacing reserve. Rule: score first, then wall time; cost counts only past the credit pacing line.

| Route | Pick | Evidence (paired, seeded bootstrap 95% CI of B − A) |
|-|-|-|
| `research.agent` | Sonnet medium (was DeepSeek flash) | 20 cases: ties DeepSeek on every score, 6.2 s faster [−16.2, −0.1]; beats Haiku high on `supported` +0.08 [0.01, 0.18]; Opus medium +0.06 [0, 0.17], 6 s slower, 3x the cost |
| `otel.agent` | Haiku high (owner override 2026-11-02 18:10; measured pick Sonnet medium; was DeepSeek flash) | 8 cases, two reruns: ties DeepSeek and Sonnet medium on score; Sonnet 13 s faster [−17.0, −9.8], Haiku $0.039 a run cheaper [0.030, 0.042]; production is over the credit pace, so the tie goes to cost. Opus no better beyond the CI, 23 s slower, 4.5x the cost |
| `diagram.agent` | Haiku none (was Sonnet medium) | 6 cases, two reruns: pass 1.00 vs 0.92 (tie), 3.9 s faster [−8.5, −0.2], 15x cheaper |
| `brain.agent`, `check` | Haiku high, unchanged | Sonnet ties or adds +0.05 inside the noise at 11-20x the cost |
| `prose.review` | DeepSeek flash, unchanged | score agreement 0.91 against 0.83-0.85 for Terra low/medium and Luna low |
| podcast stages | Sonnet medium; metadata Haiku high; `review.b` Terra medium | no eval suite; by principle (the tool loop speaks Messages since agent-workflows #107) |
| `review.angle` | Haiku high (owner hotfix, cost) | on Sonnet, 67 reviews spent $52.50 in two days ($46.29 on the angles); a live standard review after the move cost $0.158 |

Caveat: at effort low and medium Sonnet 5.5 spent almost no reasoning tokens in OpenCode agent steps (adaptive
thinking), so its two effort arms are close to one. Eval spend: $6.91 Claude credit, $0.36 IU.

## Artificial Analysis, Intelligence Index v5.0 (read 2026-10-30) — superseded 2026-11-02

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
  `review.router`, `review.ocr`, `review.adversary`) fall back across Luna (Azure Sweden Central) and Terra (AWS
  us-east-1) on the chat wire, two backends; `triage` has no fallback.
- **IU's DeepSeek price:** IU bills the list peak rate ($0.30 / $1.20) at every hour, off-peak included (billed over list
  = 1.00 at 00:00-02:00 UTC, 10 days of steps); the OpenRouter price ($0.045 / $0.50) comes from cheaper hosts.
- **Vendor split on balance failure:** GPT routes fall back to DeepSeek, DeepSeek routes to Terra; OpenAI's balance is
  not DeepSeek's.
- **Residency:** not a criterion (owner, 2026-10-30). For the record: Terra answers from AWS us-east-1 on chat and Responses, Luna from Azure Sweden Central on chat and from AWS us-east-1 on Responses, DeepSeek from Requesty-Global.
- **Spend:** Haiku's 7-day production spend was about $17, nearly all review angles; Terra medium puts that near $115.

## Addendum 2026-10-31: Claude on the direct API, and why the review eval cannot rank models — superseded 2026-11-02

- Claude agent steps now run on the direct Anthropic API (agent-workflows 5e1a871). Before that, OpenCode's Anthropic
  protocol ignored `reasoningEffort`, so every Haiku arm above ran at the model default: the 0.08 and 0.17 rows measure
  Haiku at an effort nobody chose.
- Direct-API arms on the same 12 deep cases (`agent-workflows/docs/evals/2026-10-31-review-claude-direct.md`): Haiku
  none / low / high / max agreement 0.08 / 0.08 / 0.50 / 0.08 at $0.04 / $0.07 / $0.15 / $1.17 per review; Sonnet 5.5
  low 0.08 at $0.52. Haiku max overflows its context (23 failed steps, 31 min p50) and is unusable for agent steps.
- The review eval's reference is the retired gateway's outcome; agreement tracks how readily a model rates a finding
  `blocking` (Terra 87, DeepSeek 23, Haiku high 15, Sonnet low 5 blocking findings over 12 reviews), and recall sits
  at 0 to 0.05 on every arm. **The Terra-over-Haiku verdict above rests on severity calibration, not review quality.**
  The seats stand until a planted-defect eval exists (agent-workflows `docs/waves/PLAN.md`, Wave 1).
