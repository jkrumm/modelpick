# Execution-Mode Framework — Where Work Runs

This record captures the **rationale** behind the orchestrator's execution-mode framework:
why work is routed across inline / subprocess / MCP / fork, why model tiers (Haiku / Sonnet /
Opus / Kimi-K2.6) map to specific homes, and why the orchestrator's own model must not change
mid-session.

> **Operational directives live elsewhere.** The terse, always-on "how" — the routing table,
> the offloading rules, the async-job contract, the parallelism tiers — is in dotfiles
> `config/global.CLAUDE.md` (the "Token Efficiency" section). That file is the executable
> convention; **this record is the evidence and reasoning behind it.** When the two ever drift,
> dotfiles is the source of truth for behavior; this file explains why the behavior is shaped
> the way it is.

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

## The four execution modes — and why each exists

| Mode | What it is | Why it exists |
|-|-|-|
| **inline** | runs on the current session model, output lands in main context | For conversational/orchestrating work that genuinely needs session context (committing, shipping, planning). Zero switch cost — but output pollutes context, so keep it short. |
| **subprocess** | a shelled-out `claude -p` with isolated output | For read-heavy work with large isolated output that doesn't need structured guarantees. Off Max (IU per-token). Cold spawn ~500ms; no cache reuse across calls. |
| **MCP (worker)** | a job submitted to an always-on worker server, schema-validated output | For heavy work whose output is parsed programmatically, or that runs >30s. Workers run on Kimi-K2.6 (EU) off Max — see [kimi-bridge.md](./kimi-bridge.md). This is the default for fan-out. |
| **fork** | an Agent-tool sub-session wrapping a live MCP | Only when the work needs a live MCP server the main session has registered (e.g. a browser driver) that the worker server can't host. Burns Max quota — last resort. |

The routing logic is a decision tree:

- Needs the orchestrator's conversation context? → **inline**
- Fully describable by inputs, output verbose? → **subprocess**
- Output parsed programmatically, or run >30s? → **MCP (worker)**
- Needs a live registered MCP server? → **fork**

## Model tiers map to homes

- **Kimi-K2.6 (EU)** is the worker model for off-Max text tasks — validation, review, research,
  mechanical implementation. See [kimi-bridge.md](./kimi-bridge.md) for why and the bridge
  lessons.
- **Haiku** — cheap/fast, used by subprocess read tasks and simple vision (where it ties on
  simple diagrams — see [vision-and-image.md](./vision-and-image.md)).
- **Sonnet** — the orchestrator's default working model and the EU fallback
  (`claude-sonnet-4-6-eu`) across the chain.
- **Opus** — reserved for novel hard logic that genuinely needs the strongest model, on Max.

The principle: spend the expensive tier (Max / Opus) only on what actually needs it; route
everything verifiable and verbose to the free/cheap tiers.

## Why "never switch the orchestrator's model mid-session"

Switching the orchestrator's model mid-conversation **invalidates the prompt cache** for at
least one turn — and in a long session that is the single biggest avoidable cost. The whole
framework exists *precisely so the orchestrator doesn't need to switch*: instead of changing
the main model to do cheaper work, it delegates that work to a different home (subprocess,
worker, fork) that runs its own model in isolation. The orchestrator stays on one model,
keeps its cache warm, and never grinds raw material itself.

## Parallelism, cheapest first

Escalate a tier only when the one below can't do the job:

1. **Parallel worker calls in one turn** — near-zero cost (Kimi workers). The default for
   independent, verifiable units. Under-used relative to its value.
2. **subprocess** — near-zero (IU per-token), for read-heavy isolated output.
3. **Background agent driving workers** — moderate (a thin Max orchestrator that delegates,
   doesn't grind), for long detachable work.
4. **Foreground agent on Opus** — full Max, isolated cache, for novel hard logic.
5. **Agent teams** — N× Max or cloud $$$, only for genuinely hard parallel reasoning.

Background agents and agent teams buy *detachment and coordination*, not cheap parallelism —
they run on Max. Free parallelism comes from fanning out worker calls, where the orchestrator
just awaits concurrent off-Max jobs.
