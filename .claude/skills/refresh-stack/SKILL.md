---
name: refresh-stack
description: Run the whole model-currency loop end to end — catalog import, access probe, leaderboard collect, re-score, deployment re-verification — then report only what changed and what is now worth reconsidering. Trigger when the user says the benchmarks/recommendations/dashboard are stale or outdated, asks to refresh or update the model data, mentions new models on the IU endpoint, asks "should I switch X", or wants to know whether any service is running a model it should not be.
---

# Refresh Stack

One command loop that keeps modelpick true, plus the report that makes the result
actionable. `bun run refresh` already refreshes the *metrics*; this skill also refreshes the
*catalog* and the *deployment truth table*, and then does the part no script can: say which
of the changes is worth acting on.

Inline skill — orchestrate in the main session. The scripts are verbose; report deltas only,
never their raw output.

Settled patterns: **[`docs/GUIDELINES.md`](../../../docs/GUIDELINES.md)**. Per-model settings:
**[`docs/decisions/model-configs.md`](../../../docs/decisions/model-configs.md)**. Do not
re-derive either from the data — a refresh updates the numbers, not the rules.

## What this refreshes, and what it cannot

| Layer | Refreshed by | Notes |
|-|-|-|
| IU catalog (`src/db/iu-catalog.ts`) | `/update-iu-models` | Needs a human-saved HTML export. Skip when no new export exists. |
| Live access + residency (`capability_probe`) | `bun run probe` | Listed ≠ callable. This is the only thing that proves access. |
| Leaderboards (`metric_snapshot`) | `bun run collect` | OpenRouter · AA · Epoch · EQ-Bench · LMArena. |
| Recommendations (`recommendation`) | `bun run recommend` | Re-scores every category against the new metrics. |
| Deployment truth (`deployment`) | `bun run verify-deployments` | Reads the *other repos'* config files. |
| ccbench agentic runs (`bench_run`) | `bun run bench` | **Spends real money. Never run as part of a refresh** — only when a candidate genuinely needs an agent-loop floor test. |
| Fast-tier effort/latency (`fast_*`) | `bun run bench:fast` | **Spends real money (small). Not part of a refresh** — run it when a fast-slot candidate changes, or when a latency claim needs settling across effort levels. |

## Steps

1. **Catalog, only if there is something new.** Ask once whether a fresh check-key export
   exists. If yes, run `/update-iu-models` and come back. If no, skip — do not block the
   rest of the loop on it.

2. **Refresh the metrics.**
   ```bash
   bun run refresh
   ```
   Steps are independent; one failure does not abort the others but the exit is 1. Report
   any failed step verbatim — a silently half-refreshed snapshot is worse than a stale one.

3. **Re-verify the deployment table** — the step that catches config drift in other repos:
   ```bash
   bun run verify-deployments
   ```
   - `broken` rows mean a service moved and `src/db/deployments.ts` did not. Go read the
     named `config_ref`, fix the row, re-run.
   - `indirect` rows (`literal_id: false`) are aliases/inherited values that no substring
     check can confirm. Spot-check them by hand roughly quarterly, not every run.
   - Once it reports `0 broken`, stamp and re-seed:
     ```bash
     bun run verify-deployments --update && bun run db:seed
     ```

4. **Read the drift, don't just list it.** Open `/stack` (or query `deployment` joined to
   `recommendation`) and triage every flag into exactly one of three buckets:

   | Bucket | Meaning | Action |
   |-|-|-|
   | **Act** | A slot's category recommendation changed *and* the reason applies to that slot | Propose the switch with the evidence |
   | **Explain** | The recommendation changed but the slot is right anyway | Write the why into the row's `rationale` so it stops re-surfacing |
   | **Ignore** | Structural slot (`category: null`) or a manual category | No drift is possible; nothing to do |

   Most flags are **Explain**. A drift flag is a prompt to write down a reason, not a
   prompt to switch models.

5. **Report.** Under 15 lines. Only:
   - models newly accessible / newly lost (from the probe delta)
   - categories whose top recommendation changed, with old → new and the metric that moved
   - deployment rows that broke, and what they are now
   - the **Act** bucket, with a recommendation per item
   - anything that failed

## Traps

- **A metric is not comparable across reasoning configs.** `metric_snapshot.conditions`
  records the thinking setting a `live` measurement was taken under. A `ttft_ms` at
  `thinking: off` and one at `default` differ by an order of magnitude on the same model —
  never rank them against each other. This is how `gpt-5.6-luna` was once read as
  categorically faster than it is.
- **The recommender scores categories; services run slots.** One category maps to several
  slots that legitimately differ — Claude Code's interactive session and its unattended
  worker are both `coding` and are deliberately not the same model. Never "fix" a slot to
  match a category recommendation without checking the slot's own rationale first.
- **A category pick with zero slots is fiction.** `/stack` shows a slot count per category
  pick. A `0` means nothing runs it — either wire it or retire the pick; do not keep
  scoring it as though it mattered.
- **Most drift is not a switch.** Before proposing one, check `follows_recommendation`: a
  Max-plan slot (cost term meaningless) and an unattended worker (ccbench governs, not the
  quality-led `coding` profile) are marked `false` on purpose. If a genuinely-following slot
  drifts, check *which dimension* moved — the `writing` recommendation moved to a model with
  no `arena_german` row at all, which is a scoring artifact, not a better German writer.
- **There is no residency flag, by choice.** Residency is a fact on `capability_probe` and an
  argument inside a decision record. It is not a per-slot alarm — that produced six
  permanently-orange rows nobody was going to act on.
- **Green scripts ≠ working pipeline.** The tests mock the collectors. Confirm against live
  data before believing a refresh worked.
- **Never run `bun run bench` here.** It drives real `claude -p` sessions and bills for
  them. It answers "can this model hold an agent loop", not "which model is smarter", and a
  refresh never needs that question answered.
