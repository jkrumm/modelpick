# Model usage guidelines

The established patterns. Everything here is settled and current — no history, no retractions.
Evidence lives in [`decisions/`](decisions/); this file is what to *do*.

Established 2026-09-12 after a run of measurements that overturned four earlier conclusions.
Each rule below exists because getting it wrong cost a wrong production pick.

---

## 1. Choosing a model

### 1.1 Check which gateway leg serves it — first, before anything else

The IU gateway has two legs and they do not serve the same models.

| | `/openai/v1` | `/anthropic/v1` |
|-|-|-|
| `gpt-5.6-luna` · `deepseek-v4.1-flash` · `gemini-3.8-flash` | yes | **404** |
| `glm-5.3-flash` · `minimax-m3` | yes | yes |

**Claude Code speaks the Anthropic protocol.** So every sideclaw `session` tool, every
`agent-dispatch` worker, every warden episode and every `ca <id>` launch can only run
`claude-*`, `glm-5.3-flash` or `minimax-m3`. Most "should we switch X to Luna/DeepSeek"
questions are closed by this line, not by a tradeoff.

### 1.2 Match the metric to the job, or say you are guessing

A score whose *name* matches the question is not evidence that it measures the question. This
has produced three wrong answers here:

| metric | what it measures | what it was misread as |
|-|-|-|
| `arena_german` | preference over German **chat** | German **prose quality** |
| AA `quality` | general intelligence index | **vision** capability |
| live `ttft_ms` | latency **at the effort it was captured with** | the model's latency |

Before a metric moves a pick, write two lines: what the metric measures, and what the slot
does. If they are not obviously the same sentence, it is a proxy — say so in the decision
record instead of switching. `vision`, `image` and `embedding` are **manual** categories for
exactly this reason.

**When no metric fits, run a blind bake-off on the real task.** That is how TTS, dense-diagram
reading and the Claude Code model were all actually decided. Half an hour of it beats any
leaderboard column.

### 1.3 A category recommendation does not govern a slot that deliberately diverges

One category maps to many slots. Claude Code's interactive session and its unattended worker
are both `coding` and are deliberately different models. Mark those slots
`follows_recommendation: false` in `src/db/deployments.ts` with the reason inline — otherwise
drift fires on well-understood divergence and 28 of 54 slots light up, which is
indistinguishable from no signal.

Three standing reasons a slot legitimately ignores its category: it runs on the **Max plan**
(the cost term is meaningless), it is **governed by ccbench** rather than the leaderboard
(unattended workers), or it is a **structural** pick no category scores (an adversary tier
whose value is being a different vendor).

### 1.4 A category pick with zero running slots is fiction

`/stack` shows a slot count per category pick. A `0` means nothing runs it. Either wire it or
retire it; do not keep scoring it.

---

## 2. Configuring a model

### 2.1 Thinking is the quality lever, not overhead

`gpt-5.6-luna` by effort: **16.8 · 21.8 · 25.8 · 32.4 · 34.8 · 37.5** for
`none`/`low`/`medium`/`high`/`xhigh`/`max`. Setting `none` does not make it a faster Luna — it
makes it less than half the model. Never run a judgment task at `none` because the latency
looked good.

There is exactly one case where we lower a setting, and it is because the higher one buys
nothing: see 2.3.

### 2.2 When a call returns empty, raise the budget before lowering the effort

Unused budget is **not billed**. Lost effort is lost intelligence. Every reasoning model bills
hidden thinking against the same output budget as visible text, so a budget sized for the
answer is consumed by the thinking and the call returns **HTTP 200 with empty content and
`finish_reason: length`** — no error, no exception.

This has bitten in production (`argo/apps/api/src/lib/ai-sentence.ts`) and twice in our own
benchmark harness, where it produced two wrong verdicts before it was found. Minimum safe
budget on any thinking model: **~2,000 tokens**, and 16,000 for a tool loop or long output.

**Every call site must assert non-empty content and log `finish_reason`.** Silent empty
responses degrade to "no result today" and look identical to "nothing to do".

### 2.3 Set the effort explicitly — the defaults are not neutral

| model | default if omitted | set it to |
|-|-|-|
| `gpt-5.6-luna` | `medium` | `medium` for balanced work, `high` for complex agentic loops |
| `glm-5.3-flash` | **`max`** | **`high`** — `low` only for fixed-label classification. On the Anthropic leg (Claude Code) effort is ignored: set `MAX_THINKING_TOKENS` (8192 agentic, 2048 classify) |
| `deepseek-v4.1-flash` | provider default | **`high`** with `max_completion_tokens` ≥16,000 — its thinking fills whatever budget it is given |

`glm-5.3-flash` at its `max` default spends **14,874 reasoning tokens where `high` spends 266**,
producing a slightly worse result 4.6× slower, and returning *nothing at all* at a normal
budget. Its default is its worst setting. `medium` is rejected outright — it accepts
`low`/`high`/`max` only.

Full per-model settings, including the Anthropic-leg thinking controls and the
`MAX_THINKING_TOKENS` mapping for Claude Code: [`decisions/model-configs.md`](decisions/model-configs.md).

### 2.4 Configure for capability where the economics allow it — and check whether they do

A budget or an effort cap is a constraint on the model's ability. Apply one only where
something real forces it, and check the arithmetic before assuming something does.

Worked example, the Hermes brain. It re-sends a large prefix every turn for up to 90 turns.
A 31k-prefix probe once read **zero cached tokens** for `deepseek-v4.1-flash` and priced its warm
turn at 14.9× Luna's. Production disagreed: the brain's real sessions read 92–96% of input from
cache, and at the rates the gateway actually bills ($0.50 / $0.05 cached / $1.50) a real 52-call
thread cost ~2× what Luna would have. The probe missed a cache that was there.

The owner took `deepseek-v4.1-flash` anyway (2026-09-13): the higher ceiling, a 1M window, and
one model across every mid-size lane were worth the price. That is a legitimate outcome of this
section — the rule is not "the cheaper model wins", it is **know the real price before you
choose**. Having chosen, configure for capability: `reasoning_effort: high`, generous
`max_completion_tokens`, no cap that exists only to save money.

The generalisable rule: **measure the economics at the slot's real operating point, not at a
convenient one.** A cache changes the answer by an order of magnitude, and only shows up when
the prefix is realistic. A zero from one cache probe is not proof of no cache: re-run it, and check
real session usage before acting on it.

### 2.5 Gateway traps that apply to every model

1. **`max_completion_tokens`, never `max_tokens`** on the OpenAI leg — 503 otherwise.
2. **Never send an explicit `temperature`** — 503, `Only the default (1) value is supported`.
3. **Effort goes top-level, never `extra_body: {"reasoning": …}`** — rejected with
   `Unknown parameter: 'reasoning'`.
4. **On the Anthropic leg, `thinking: {type: "disabled"}` is accepted and ignored.** It still
   thinks, and costs more than sending nothing. `budget_tokens` is the only control that works.
5. **`gpt-5.x` rejects function tools combined with `reasoning_effort` on `/chat/completions`**
   (503, probed 2026-09-13) — a tool loop on Luna over Chat runs without effort, or moves to
   Responses. `deepseek-v4.1-flash` accepts the combination, but has no Responses route (404).
6. **`completion_tokens_details.reasoning_tokens` is misreported as `0`** by some routes
   (`deepseek-v4.1-flash`) while the thinking is billed inside `completion_tokens`. Infer the
   split rather than trusting the field.

---

## 3. Measuring a model

### 3.1 The headline is total wall time to a *correct* answer

Not time-to-first-token. A model that starts late and decodes fast can still finish first — the
crossover against `gpt-5.6-luna` is around **84–107 visible tokens**, i.e. two sentences. Every
TTFT-led comparison made here before 2026-09-12 was measuring below that crossover and reached
the wrong conclusion.

### 3.2 The budget must not starve the model under test

This is the single most expensive mistake in this repo's history — it produced two retracted
verdicts from two different constants in the same file. A model that spends its whole
allowance thinking looks exactly like a model that failed the task.

Give every candidate ≥16,000 tokens unless the cap *is* the thing being tested, and classify
`starved` (`finish_reason: length` with zero visible output) as **its own outcome**, never as a
failed answer. Exclude starved calls from the pass-rate denominator.

### 3.3 Medians, ≥3 repeats, and every timing metric from the same calls

Means let one tail move the number. Medians taken over *different subsets* produce
`wall < ttft`, which is impossible and was shipped once. Compute all per-cell medians from the
same array of timing-complete rows, and report how many rows were dropped.

Decode rate measured over a 12-token reply is not a decode rate — compute it only from calls
with ≥200 visible tokens.

### 3.4 Record the conditions with every latency number

`metric_snapshot.conditions` holds the reasoning setting a `live` measurement was taken under.
A `ttft_ms` at `off` and one at `default` differ by an order of magnitude on the same model;
`normalizeMetrics()` drops speed metrics captured at `off` rather than ranking them together.
A latency claim without its effort setting is not a claim.

### 3.5 Graders must be deterministic *and* unambiguous

Check that exactly one answer is correct before trusting a failure. An ambiguous task graded 29
identical correct answers across five models as wrong, and nearly disqualified a model on it.
If every model "fails" the same way, the grader is wrong, not the field.

### 3.6 Never read an operational benchmark as a quality benchmark

`ccbench` measures whether a model can hold an agent loop; `bench-fast` measures the cost of
correctness on deliberately easy tasks. Both measure a **floor**. A perfect score means the
floor was cleared, never that the model is smart.

---

## 4. Recording a decision

1. **Every running slot goes in `src/db/deployments.ts`** with the file that wires it
   (`config_ref`) and the date that file was last read (`verified_at`).
2. **`bun run verify-deployments`** checks those claims mechanically against the other repos.
   It caught two wrong rows on its first run. Run it before trusting `/stack`.
3. **Every pick gets a decision record** in `decisions/` with the evidence and a stated
   re-open trigger. A pick without a re-open trigger is a pick nobody will revisit.
   Each record opens with a **Current verdict** block; when a later section reverses an earlier
   one, mark the earlier section superseded rather than leaving a reader to find the reversal
   300 lines on.
4. **Cross-check every verdict block against the `deployment` table, not against the record's
   own prose.** The table is verified against the real config files; a record is not. This
   caught a verdict claiming `claude-opus-5` wrote the podcast outline when the live config had
   said `gpt-5.6-luna` for weeks — a stale sentence promoted into a "current" claim, which is
   precisely the drift this structure exists to stop.
5. **Write the reason a drift flag is wrong into the row's `rationale`**, so it stops
   re-surfacing. Most drift is an explanation owed, not a switch to make.
6. **Refresh with [`/refresh-stack`](../.claude/skills/refresh-stack/SKILL.md)** — catalog,
   probe, collect, recommend, verify, then triage. It never runs the spending benchmarks.

---

## 5. The current picks

Not restated here — they live in `MY_STACK` (`src/db/seed.ts`), the `deployment` table, and the
live `/stack` page, so this file cannot drift from them. Each carries a link to its record.
