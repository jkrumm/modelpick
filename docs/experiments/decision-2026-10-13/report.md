# bench-decision report

Generated 2026-10-13T14:05:31.395Z. Models: clef, clef-eu, clef-flash, pplx-decider-v1-27b, jev-latest, decision-1, decision-1-eu, gpt-6-luna:decisions. Suites: contact-form-verdict (25 cases), email-triage (15 cases), urgency-score (8 cases), hard-verdict (20 cases). Repeats: 3.
Total spend: $0.0892 (includes rate-card estimates for wires that report no cost).


## Headline

Ranked by accuracy (macro average over suites), then Brier, then median latency; a model failing more than 10% of calls is ranked below every reliable one.

| # | model | accuracy | Brier | p50 ms | $/1k calls | errors | refusals | unstable cases |
|-|-|-|-|-|-|-|-|-|
| 1 | `pplx-decider-v1-27b` | 100.0% | 0.0011 | 342 | $0.019 | 0/204 | 0.0% | 0 |
| 2 | `gpt-6-luna:decisions` | 100.0% | 0.0111 | 303 | $0.049 (est.) | 0/204 | 0.0% | 0 |
| 3 | `jev-latest` | 100.0% | 0.0122 | 266 | $0.030 | 0/204 | 0.0% | 0 |
| 4 | `clef-eu` (EU) | 97.8% | 0.0464 | 144 | $0.129 | 0/204 | 0.0% | 0 |
| 5 | `clef` | 96.1% | 0.0658 | 359 | $0.129 | 0/204 | 0.0% | 0 |
| 6 | `clef-flash` | 94.1% | 0.1479 | 381 | $0.048 | 0/204 | 0.0% | 0 |
| 7 | `decision-1` | 93.8% | 0.0045 | 320 | $0.016 (est.) | 0/204 | 0.0% | 2 |
| 8 | `decision-1-eu` (EU) | 92.7% | 0.0051 | 191 | $0.016 (est.) | 0/204 | 0.0% | 2 |

## Accuracy per suite

| model | `contact-form-verdict` | `email-triage` | `urgency-score` | `hard-verdict` |
|-|-|-|-|-|
| `pplx-decider-v1-27b` | 100.0% | 100.0% | 100.0% | 100.0% |
| `gpt-6-luna:decisions` | 100.0% | 100.0% | 100.0% | 100.0% |
| `jev-latest` | 100.0% | 100.0% | 100.0% | 100.0% |
| `clef-eu` | 96.0% | 100.0% | 100.0% | 95.0% |
| `clef` | 96.0% | 93.3% | 100.0% | 95.0% |
| `clef-flash` | 88.0% | 93.3% | 100.0% | 95.0% |
| `decision-1` | 100.0% | 100.0% | 75.0% | 100.0% |
| `decision-1-eu` | 100.0% | 100.0% | 70.8% | 100.0% |

## Where the field splits

| case | models that missed it (wrong/graded) |
|-|-|
| `contact-form-verdict/acquisition-offer` | clef-flash (3/3) |
| `contact-form-verdict/bug-report-de-terse` | clef-flash (3/3) |
| `contact-form-verdict/reseller-licence-pitch` | clef (3/3), clef-eu (3/3), clef-flash (3/3) |
| `email-triage/security-alert` | clef (6/6), clef-flash (3/6) |
| `email-triage/visitor-confirmation` | clef-flash (3/6) |
| `urgency-score/casual-suggestion` | decision-1 (2/3), decision-1-eu (2/3) |
| `urgency-score/site-down-checkout` | decision-1 (3/3), decision-1-eu (3/3) |
| `urgency-score/berth-cancelled-guests-arriving` | decision-1-eu (2/3) |
| `hard-verdict/hard-legit-urgent-commands` | clef-flash (3/3) |
| `hard-verdict/hard-legit-found-via-google` | clef (3/3), clef-eu (3/3) |

## Errors

No call failed.

## Caveats

- Accuracy saturates: on a clean suite most models score the same, so Brier (calibration) and latency decide the order. A perfect score clears a floor, it does not prove the model is good (GUIDELINES §3.6).
- Brier is the multi-class squared error over the question's options for choice questions, and the squared error of P(yes) for boolean ones. Score questions have no probability target and contribute accuracy only.
- Errors (HTTP, timeout, malformed envelope) are excluded from accuracy, latency and cost, and reported on their own. A refusal is neither correct nor wrong.
- `unstable cases` counts (suite, case) pairs whose graded outcome differed between repeats.
- Cases are synthetic; labels follow each question's own instructions. A case two defensible labels could fit was rewritten, not kept as hard.
- Latency is wall time of one non-streaming call from the dev host to IU's unified endpoint, not model time.
