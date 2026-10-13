# bench-decision report

Generated 2026-10-13T13:34:33.683Z. Models: clef, clef-eu, clef-flash, pplx-decider-v1-27b, jev-latest, decision-1, decision-1-eu, gpt-6-luna:decisions. Suites: contact-form-verdict (25 cases), email-triage (15 cases), urgency-score (8 cases). Repeats: 3.
Total spend: $0.0611 (includes rate-card estimates for wires that report no cost).


## Headline

Ranked by accuracy (macro average over suites), then Brier, then median latency; a model failing more than 10% of calls is ranked below every reliable one.

| # | model | accuracy | Brier | p50 ms | $/1k calls | errors | refusals | unstable cases |
|-|-|-|-|-|-|-|-|-|
| 1 | `pplx-decider-v1-27b` | 100.0% | 0.0015 | 335 | $0.019 | 0/144 | 0.0% | 0 |
| 2 | `gpt-6-luna:decisions` | 100.0% | 0.0102 | 309 | $0.048 (est.) | 0/144 | 0.0% | 0 |
| 3 | `jev-latest` | 100.0% | 0.0123 | 265 | $0.029 | 0/144 | 0.0% | 0 |
| 4 | `clef-eu` (EU) | 98.3% | 0.0365 | 216 | $0.125 | 0/144 | 0.0% | 1 |
| 5 | `clef` | 96.4% | 0.0559 | 337 | $0.125 | 0/144 | 0.0% | 0 |
| 6 | `decision-1` | 94.4% | 0.0059 | 313 | $0.015 (est.) | 0/144 | 0.0% | 1 |
| 7 | `clef-flash` | 93.8% | 0.1354 | 390 | $0.047 | 0/144 | 0.0% | 0 |
| 8 | `decision-1-eu` (EU) | 88.9% | 0.0058 | 201 | $0.015 (est.) | 0/144 | 0.0% | 1 |

## Accuracy per suite

| model | `contact-form-verdict` | `email-triage` | `urgency-score` |
|-|-|-|-|
| `pplx-decider-v1-27b` | 100.0% | 100.0% | 100.0% |
| `gpt-6-luna:decisions` | 100.0% | 100.0% | 100.0% |
| `jev-latest` | 100.0% | 100.0% | 100.0% |
| `clef-eu` | 96.0% | 98.9% | 100.0% |
| `clef` | 96.0% | 93.3% | 100.0% |
| `decision-1` | 100.0% | 100.0% | 83.3% |
| `clef-flash` | 88.0% | 93.3% | 100.0% |
| `decision-1-eu` | 100.0% | 100.0% | 66.7% |

## Where the field splits

| case | models that missed it (wrong/graded) |
|-|-|
| `contact-form-verdict/acquisition-offer` | clef-flash (3/3) |
| `contact-form-verdict/bug-report-de-terse` | clef-flash (3/3) |
| `contact-form-verdict/reseller-licence-pitch` | clef (3/3), clef-eu (3/3), clef-flash (3/3) |
| `email-triage/security-alert` | clef (6/6), clef-flash (3/6) |
| `email-triage/visitor-confirmation` | clef-flash (3/6) |
| `urgency-score/casual-suggestion` | decision-1-eu (2/3) |
| `urgency-score/site-down-checkout` | decision-1 (3/3), decision-1-eu (3/3) |
| `urgency-score/berth-cancelled-guests-arriving` | decision-1-eu (3/3) |

## Errors

No call failed.

## Caveats

- Accuracy saturates: on a clean suite most models score the same, so Brier (calibration) and latency decide the order. A perfect score clears a floor, it does not prove the model is good (GUIDELINES §3.6).
- Brier is the multi-class squared error over the question's options for choice questions, and the squared error of P(yes) for boolean ones. Score questions have no probability target and contribute accuracy only.
- Errors (HTTP, timeout, malformed envelope) are excluded from accuracy, latency and cost, and reported on their own. A refusal is neither correct nor wrong.
- `unstable cases` counts (suite, case) pairs whose graded outcome differed between repeats.
- Cases are synthetic; labels follow each question's own instructions. A case two defensible labels could fit was rewritten, not kept as hard.
- Latency is wall time of one non-streaming call from the dev host to IU's unified endpoint, not model time.
