# Execution-Mode Framework — Where Work Runs

This record captures the **rationale** behind the orchestrator's execution-mode framework:
why work is routed across inline / native subagent / MCP / subprocess / research-gateway, why
model tiers (Haiku / Sonnet / Opus / IU) map to specific homes, and why the orchestrator's own
model must not change mid-session.

> **Operational directives live elsewhere.** The terse, always-on "how" — the routing table,
> the offloading rules, the async-job contract, the parallelism tiers — is in dotfiles
> `config/global.CLAUDE.md` (the "Delegation & parallelism" section). That file is the
> executable convention; **this record is the evidence and reasoning behind it.** When the two
> ever drift, dotfiles is the source of truth for behavior; this file explains why the behavior
> is shaped the way it is.

## The core economic premise

The main session is the **orchestrator**. Its turns are the scarcest, most expensive resource
— they consume Anthropic Max quota *and* the orchestrator's context window. Everything in the
framework follows from one bias: **push work off the orchestrator whenever capability allows.**

The orchestrator's job is to **decide and verify** — hold the plan, the user's intent, the
cross-task state, and the verdicts. It should not be the thing grinding through deep reads,
multi-file edits, and validation loops. If a piece of work is fully describable by its inputs
and its output is verbose, it belongs in a worker that hands back only the conclusion.

This is the same capability-vs-cost tradeoff that drives every model choice in these records
(see the [index](./README.md)) — applied to *where code runs* rather than *which model runs it*.

## The five execution modes — and why each exists

| Mode | What it is | Why it exists |
|-|-|-|
| **inline** | runs on the current session model, output lands in main context | For conversational/orchestrating work that genuinely needs session context (committing, shipping, planning). Zero switch cost — but output pollutes context, so keep it short. |
| **native `Agent` subagent** | the `Agent` tool spawns a subagent (`~/.claude/agents/`, e.g. `@implementer`) | The primary offload for a settled, multi-file edit in the live checkout. Fresh context and its own prompt cache (no orchestrator-cache penalty), returns a summary. Inherits the parent session's endpoint, so a Max session cannot delegate to an IU model this way. |
| **MCP (`mcp__sideclaw__*`)** | a job submitted to an always-on worker server (`check`/`review`/`dispatch`/`otel`), schema-validated output, async submit→`job_wait`→result | For heavy work whose output is parsed programmatically, or that runs >30s. Workers run on `claude-sonnet-5`/`claude-haiku-4-5`, currently Max (`SIDECLAW_WORKER_BACKEND=max`); unset falls back to the IU unified endpoint, off Max quota. This is the default for fan-out. |
| **`agent-dispatch` (subprocess)** | a thin router (`agent-dispatch bg <repo> '<task>'` / `agent-dispatch work <repo>`): `rd bg`/`rd work` for a repo resident on the mini (spawned through a herdr pane for keychain-safe Max auth), or a local `claude -p` on IU creds for a MacBook-resident repo | For a bounded episode in a repo the orchestrator isn't sitting in, with no live MCP server needed. Refuses to nest inside an interactive Claude Code session — it is a leaf, not a chain link. |
| **research-gateway (`/research`)** | agentic Tavily + Context7 + page-fetch, cross-verified cited report | For library/API/version facts past training cutoff. IU models, off Max. |

The routing logic is a decision tree:

- Needs the orchestrator's conversation context? → **inline**
- Settled multi-file edit in the live checkout, needs house-style judgment? → **native `Agent`
  subagent**
- Output parsed programmatically, or run >30s, wants schema-validated output? → **MCP
  (sideclaw)**
- Bounded episode in another repo, no live MCP needed? → **`agent-dispatch`**
- Library/API/version fact, post-cutoff? → **research-gateway**

## Model tiers map to homes

- **Sideclaw workers** run on `claude-sonnet-5` / `claude-haiku-4-5` over the native Anthropic
  route — see [claude-code-model.md](./claude-code-model.md) for the bake-off that picked real
  Claude models over the retired local-bridge lane for this job.
- **`agent-dispatch`'s MacBook leg** runs on the same IU-endpoint credential (native Anthropic
  transport), off Max — the mini leg reuses the mini's own Max keychain auth via `rd bg`, so the
  same router lands on different billing depending on which machine holds the target repo.
- **Haiku** — cheap/fast, used for simple read/vision tasks (where it ties on simple diagrams —
  see [vision-and-image.md](./vision-and-image.md)).
- **Sonnet** — the orchestrator's default working model.
- **Opus** — reserved for novel hard logic that genuinely needs the strongest model, on Max, via
  a foreground `Agent`.

The principle: spend the expensive tier (Max / Opus) only on what actually needs it; route
everything verifiable and verbose to the free/cheap tiers.

## Why "never switch the orchestrator's model mid-session"

Switching the orchestrator's model mid-conversation **invalidates the prompt cache** for at
least one turn — and in a long session that is the single biggest avoidable cost. The whole
framework exists *precisely so the orchestrator doesn't need to switch*: instead of changing
the main model to do cheaper work, it delegates that work to a different home (native subagent,
MCP worker, subprocess) that runs its own model in isolation. The orchestrator stays on one
model, keeps its cache warm, and never grinds raw material itself.

## Parallelism, cheapest first

Escalate a tier only when the one below can't do the job:

1. **Parallel `mcp__sideclaw__*` calls in one turn** — near-zero marginal cost. The default for
   independent, verifiable units. Under-used relative to its value.
2. **`agent-dispatch` subprocess** — near-zero (mini's Max keychain, or IU per-token on the
   MacBook), for a bounded episode elsewhere that doesn't need this session's context.
3. **Background `Agent` driving workers** — moderate (a thin Max orchestrator that delegates,
   doesn't grind), for long detachable work.
4. **Foreground `Agent` on Opus** — full Max, isolated cache, for novel hard logic.
5. **Agent teams** — N× Max, only for genuinely hard parallel reasoning.

Background agents and agent teams buy *detachment and coordination*, not cheap parallelism —
they run on Max. Free-or-cheap parallelism comes from fanning out MCP worker calls, where the
orchestrator just awaits concurrent off-Max jobs.
