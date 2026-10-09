# bench-decision report

Generated 2026-10-09T08:18:12.175Z. Models: clef, clef-eu, clef-flash, pplx-decider-v1-27b, jev-latest, gpt-6-luna:decisions. Suites: contact-form-verdict (25 cases), email-triage (15 cases), urgency-score (8 cases). Repeats: 3.
Total spend: $0.0561 (includes rate-card estimates for the Decisions wire, which reports no cost).


## Headline

Ranked by accuracy (macro average over suites), then Brier, then median latency; a model failing more than 10% of calls is ranked below every reliable one.

| # | model | accuracy | Brier | p50 ms | $/1k calls | errors | refusals | unstable cases |
|-|-|-|-|-|-|-|-|-|
| 1 | `pplx-decider-v1-27b` | 100.0% | 0.0015 | 274 | $0.019 | 0/144 | 0.0% | 0 |
| 2 | `gpt-6-luna:decisions` | 100.0% | 0.0108 | 233 | $0.048 (est.) | 0/144 | 0.0% | 0 |
| 3 | `jev-latest` | 100.0% | 0.0121 | 282 | $0.029 | 0/144 | 0.0% | 0 |
| 4 | `clef-eu` (EU) | 98.7% | 0.0363 | 162 | $0.124 | 0/144 | 0.0% | 0 |
| 5 | `clef` | 96.4% | 0.0475 | 360 | $0.124 | 0/144 | 0.0% | 0 |
| 6 | `clef-flash` | 91.8% | 0.1140 | 304 | $0.046 | 0/144 | 0.0% | 0 |

## Accuracy per suite

| model | `contact-form-verdict` | `email-triage` | `urgency-score` |
|-|-|-|-|
| `pplx-decider-v1-27b` | 100.0% | 100.0% | 100.0% |
| `gpt-6-luna:decisions` | 100.0% | 100.0% | 100.0% |
| `jev-latest` | 100.0% | 100.0% | 100.0% |
| `clef-eu` | 96.0% | 100.0% | 100.0% |
| `clef` | 96.0% | 93.3% | 100.0% |
| `clef-flash` | 88.0% | 100.0% | 87.5% |

## Where the field splits

| case | models that missed it (wrong/graded) |
|-|-|
| `contact-form-verdict/acquisition-offer` | clef-flash (3/3) |
| `contact-form-verdict/recruiter-specific-offer` | clef-flash (3/3) |
| `contact-form-verdict/reseller-licence-pitch` | clef (3/3), clef-eu (3/3), clef-flash (3/3) |
| `email-triage/security-alert` | clef (6/6) |
| `urgency-score/site-down-checkout` | clef-flash (3/3) |

## Errors

No call failed.

## Caveats

- Accuracy saturates: on a clean suite most models score the same, so Brier (calibration) and latency decide the order. A perfect score clears a floor, it does not prove the model is good (GUIDELINES §3.6).
- Brier is the multi-class squared error over the question's options for choice questions, and the squared error of P(yes) for boolean ones. Score questions have no probability target and contribute accuracy only.
- Errors (HTTP, timeout, malformed envelope) are excluded from accuracy, latency and cost, and reported on their own. A refusal is neither correct nor wrong.
- `unstable cases` counts (suite, case) pairs whose graded outcome differed between repeats.
- Cases are synthetic; labels follow each question's own instructions. A case two defensible labels could fit was rewritten, not kept as hard.
- Latency is wall time of one non-streaming call from the dev host to IU's unified endpoint, not model time.
