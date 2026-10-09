# Decision Models — `clef-eu` for email-gateway's decision lane

> **Current verdict (2026-10-09):** the `decision` pick is **`clef-eu`** (Cloudflare Clef, EU-hosted
> only) for email-gateway's decision lane — an owner decision, not the bench's top row. On our own
> graded bench it is fourth on accuracy (98.7%) behind three models at 100%, and the fastest by
> median call time (162 ms). The case for it is EU hosting plus latency, not accuracy. It runs today as `DECISION_MODEL: clef-eu` in
> `vps/apps/email-gateway/compose.yml`.
> **Status of this record:** current. First record of its kind.
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md); wire formats in
> [model-configs.md](./model-configs.md) §Decision models.

## What a decision model is, and why it has its own category

A decision model answers typed questions about a piece of state — **yes/no** (`noul` /
`predicate`), **choice**, **score** — and returns probabilities. It generates no text. That
breaks every assumption the chat categories rest on:

- A plain chat call is *rejected* (`response_format of type "questions" is required`). The daily
  probe used to send these models "hi" and store the rejection as `probe_status: unknown`, so
  `clef`, `clef-eu`, `clef-flash` and `pplx-decider-v1-27b` read as broken every day while working.
  They are now modality `decision` and probed with a minimal questions request.
- No chat leaderboard (OpenRouter, ArtificialAnalysis, LMArena, Epoch) scores them, so the
  recommender cannot rank them. `decision` is a **manual** category (`MANUAL_CATEGORY`) — no
  algorithmic recommendation, no drift flag — but it has its **own live eval**,
  `bun run bench:decision`, which drives the `/decision` tab.
- The numbers that matter are different: accuracy on the real questions, calibration of the
  probabilities (a lane that thresholds on confidence needs them honest), median latency, and
  cost per call.

`gpt-6-luna` is both a chat LLM and reachable on OpenAI's Decisions API. The Decisions route is
its own catalog entry, `gpt-6-luna:decisions` (modality `decision`), so the chat model row and its
five running slots are untouched.

## 2026-10-09 — the benchmark run from email-gateway

14 recorded contact-form cases, email-gateway's live `verdict` question, one call per case. The
numbers that decided the move onto UE:

| route | model | correct | median | note |
|-|-|-|-|-|
| OpenRouter | `cloudflare/clef` | 14/14 | 330 ms | owner-paid; Workers AI per-minute 429s observed |
| UE | `clef` | 14/14 | 388 ms | |
| UE | `clef-eu` | 14/14 | 165 ms | EU-hosted |
| UE | `clef-flash` | 13/14 | 335 ms | misjudged the acquisition offer; erratic confidences |
| UE | `jev-latest` | 14/14 | 291 ms | only 0.66 on the phishing case |
| UE | `pplx-decider-v1-27b` | 14/14 | 287 ms | 0.99–1.00 on nearly everything: uninformative confidences |
| UE (Decisions API) | `gpt-6-luna` | 14/14 | 277 ms | |

## 2026-10-09 — modelpick's own graded bench

`bun run bench:decision` (`scripts/bench-decision.ts`, tasks in
`src/server/bench/decision-tasks.ts`, aggregation in `decision-metrics.ts`). Six models × 48 cases
× 3 repeats = 864 calls, **$0.056**, no failed call. Full report:
[`docs/experiments/decision-2026-10-09/report.md`](../experiments/decision-2026-10-09/report.md).

Three suites, one per answer type:

- `contact-form-verdict` (25 cases) — email-gateway's live question copied verbatim (instructions
  and criteria), the 14 recorded cases above plus 11 hard ones: recruiter offer, a reseller
  "partnership" that is a licence pitch, a press enquiry, a feature request with a link, a French
  charter enquiry, phishing posing as FPP support, a yacht-site SEO pitch, a prompt injection, an
  advertising deal, a one-line CSV question, adult spam.
- `email-triage` (15 cases) — email-gateway's inbound questions: boolean spam plus the 11-way
  category choice.
- `urgency-score` (8 cases) — a four-level urgency rubric, graded within ±0.5 of the expected
  level, so score handling is exercised.

| # | model | accuracy | Brier | p50 | $/1k calls | errors |
|-|-|-|-|-|-|-|
| 1 | `pplx-decider-v1-27b` | 100.0% | 0.0015 | 274 ms | $0.019 | 0/144 |
| 2 | `gpt-6-luna:decisions` | 100.0% | 0.0108 | 233 ms | $0.048 (est.) | 0/144 |
| 3 | `jev-latest` | 100.0% | 0.0121 | 282 ms | $0.029 | 0/144 |
| 4 | `clef-eu` (EU) | 98.7% | 0.0363 | 162 ms | $0.124 | 0/144 |
| 5 | `clef` | 96.4% | 0.0475 | 360 ms | $0.124 | 0/144 |
| 6 | `clef-flash` | 91.8% | 0.1140 | 304 ms | $0.046 | 0/144 |

Accuracy is a macro average over the three suites. The Decisions wire reports no cost, so Luna's
figure is the chat rate card applied to the reported tokens — an estimate, marked as one.

What the table says and does not say:

- **Accuracy saturates.** Three models are perfect, so Brier and latency do the ranking. A perfect
  score clears a floor; it does not prove the model is good (GUIDELINES §3.6).
- **The one case the Clef family splits on is the reseller pitch.** `clef`, `clef-eu` and
  `clef-flash` call "Partnership opportunity … buy bulk licences at 40% off" legit, reading the
  subject line over the body; the other three call it marketing, which is the label under the
  question's own rule (a sender selling the owner something is marketing). `clef-eu`'s only miss
  in the whole run is this case. `clef` also calls a plain "new sign-in to your account" security
  notice spam; `clef-flash` misses the acquisition offer, the recruiter offer and the site-down
  incident.
- **PPLX's Brier of 0.0015 is not evidence of good calibration.** It was always confident and,
  here, always right. email-gateway's earlier run found it at 0.99–1.00 on nearly everything, so
  the number cannot tell a certain-and-right model from an overconfident one; this suite has too
  few misses to expose the difference. Read it as "no errors", not "well calibrated".
- **`clef-eu` is the cheapest call to wait on, not the cheapest to run.** At $0.124 per 1k calls it
  costs about 6.6x PPLX and 2.6x Luna's estimate. A shadow lane on contact-form and inbound-mail
  volume makes that small in absolute terms, but it is the price of the pick, not a rounding error.
- **Latency is wall time from the dev host**, one non-streaming call, not model time.
- **One label was dropped for being disputed.** An urgency case ("fix it before tomorrow's 9 am
  workshop") was scored 2.5–2.8 by all six models against an expected 2. A label every model
  disputes is an ambiguous label (GUIDELINES §3.5), so it was replaced with a plain lead before the
  numbers above were taken. The first full run is not what is reported.

### Verdict

**`clef-eu`, as an owner decision (2026-10-09).** The bench does not crown it; it shows the choice
costs one defensible miss (the reseller pitch) against three perfect models, in exchange for the
two things the owner weighted: **EU-only hosting** (per UE's model listing `clef-eu` is
EU-only, `clef` is routed Global or EU, `clef-flash` and PPLX are Global, Jev's is not stated) and
the **fastest call** (162 ms, about 70 ms under the next model). The lane is shadow-mode and never
authoritative — its verdict is stored beside the LLM classifier's and never delivers or drops mail
— so a rare miss is logged and compared, not acted on.

If residency stops being a requirement, the bench points to `jev-latest` (perfect, low Brier,
$0.029 per 1k) or `gpt-6-luna:decisions` (perfect, 233 ms, but it reads US on the access probe and
reports no cost on the wire) rather than staying on `clef-eu` by inertia.

## History

| date | change | why |
|-|-|-|
| 2026-09-21 | Vercel AI Gateway Jev returned 403 "free tier" | the lane's first home went away |
| 2026-10-05 | moved to OpenRouter `cloudflare/clef` | owner-paid; Workers AI per-minute 429s appeared |
| 2026-10-09 | moved to UE `clef-eu` | IU-billed, EU-hosted, 165 ms; the benchmark above |

## Landscape (research, 2026-10-09)

- **No independent leaderboard covers all of these models.** Cloudflare's own Decision Index
  (`clef-evals.workers-ai-mle.workers.dev`) scores Clef, Clef Flash and Jev on accuracy, ECE and
  latency — a vendor board for a vendor's models.
- OpenRouter's decision rankings (`openrouter.ai/rankings/decisions`) are **usage-based only**.
- PPLX Decider is a 27B model released around 2026-10-01; a v1.1 exists.
- GPT-6 Luna's Decisions API has **no independent eval**. OpenAI lists it as a limited preview
  publicly; it is available through UE.
- `jev-latest` and `jev-1.13.0` are callable on UE but absent from `/models` (the pin and its
  alias answer identically); they are catalogued by hand in `src/db/decision-models.ts`.

## Re-open triggers

Any one of these re-runs `bun run bench:decision` and revisits the pick:

1. **A new decision model on UE.** It will appear in `/models` as an ordinary chat model and fail
   the probe with the `questions is required` error — add its id to `src/db/decision-models.ts`
   (and `CANDIDATE_MODELS` in the bench script) and it is probed and benched correctly.
   PPLX Decider v1.1 and any new Jev pin are the first candidates.
2. **`clef-eu` starts failing** in email-gateway — 429s, 5xx or malformed answers in the
   `jev_*` job failures — or its median latency stops being the lowest.
3. **Agreement drops.** The decision lane's verdict and the LLM classifier's verdict, which
   email-gateway stores side by side per submission, disagree noticeably more often than they do
   now.
4. **The residency requirement changes.** Without it the ranking above decides, not the EU line.
5. **A bench re-run moves `clef-eu` further.** A miss on a genuine job offer, sponsorship or
   charter enquiry (a false negative costs a lead), or a gap to the best model on
   `contact-form-verdict` wider than the 4 points it shows now.

## Consumers

`email-gateway` (VPS container) — one decision slot and four LLM slots, all in `src/db/deployments.ts`
and checked by `bun run verify-deployments`:

| slot | model | wired in |
|-|-|-|
| `decision-lane` | `clef-eu` | `vps/apps/email-gateway/compose.yml` `DECISION_MODEL` |
| `spam-classifier`, `enrichment`, `thread-summary`, `draft-reply` | `gpt-6-luna` (chat) | `compose.yml` `LLM_MODEL` — one env var, four lanes |
