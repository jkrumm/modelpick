# Execution-Mode Framework — Where Work Runs

> **Current verdict (2026-10-05):** four lanes start agent work — `@implementer` (native
> subagent), `sideclaw dispatch` (OpenCode worker), an `rd wave` tab, `warden run` — plus the
> inline, MCP (`check`/`review`/`otel`) and `/research` modes; this is the rationale record behind
> dotfiles' operational table and `docs/agent-platform.md`. **A settled multi-file edit now
> defaults to `mcp__sideclaw__dispatch`** (tier `implement`, off Max), not a native subagent —
> `@implementer` is reserved for work that must land in this session's live uncommitted tree or
> needs tight iteration. `agent-dispatch` and `rd bg` no longer exist. Which model a worker runs:
> sideclaw `GET /api/routing` (mostly IU models on OpenCode), never this record.
> **Status of this record:** current
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

This record captures the **rationale** behind the orchestrator's execution-mode framework:
why work is routed across inline / native subagent / MCP / `rd wave` + `warden run` / research-gateway, why
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
| **MCP (`mcp__sideclaw__*`)** | a job submitted to an always-on worker server (`check`/`review`/`dispatch`/`otel`), schema-validated output, async submit→`job_wait`→result | For heavy work whose output is parsed programmatically, or that runs >30s. Per-route model and backend (Max vs IU) come from `GET /api/routing`; `dispatch` runs OpenCode. This is the default for fan-out. |
| **`rd wave` tab / `warden run`** | `rd wave <repo> '<prompt>'` adds a wave tab in the repo's herdr workspace (Max, spawned through a herdr pane for keychain-safe auth); `warden run <repo>` opens an item on warden's ledger | `rd wave` for long work the owner watches or steers; `warden run` for unattended work tracked to an outcome. |
| **research-gateway (`/research`)** | agentic Tavily + Context7 + page-fetch, cross-verified cited report | For library/API/version facts past training cutoff. IU models, off Max. |

The routing logic is a decision tree:

- Needs the orchestrator's conversation context? → **inline**
- Settled multi-file edit in the live checkout, needs house-style judgment? → **native `Agent`
  subagent**
- Output parsed programmatically, or run >30s, wants schema-validated output? → **MCP
  (sideclaw)**
- Long work to watch or steer? → **`rd wave` tab**; unattended and tracked to an outcome? →
  **`warden run`**
- Library/API/version fact, post-cutoff? → **research-gateway**

## Model tiers map to homes

- **Sideclaw workers** are mostly IU models on OpenCode (judgment such as review synthesis stays
  on Sonnet/Max) — the live table is `GET /api/routing`;
  [claude-code-model.md](./claude-code-model.md) holds the bake-off history.
- **`rd wave` tabs** run on Max via the mini's keychain auth (`sonnet` by default).
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
MCP worker, dispatch episode) that runs its own model in isolation. The orchestrator stays on one
model, keeps its cache warm, and never grinds raw material itself.

## Parallelism, cheapest first

Escalate a tier only when the one below can't do the job:

1. **Parallel `mcp__sideclaw__*` calls in one turn** — near-zero marginal cost. The default for
   independent, verifiable units. Under-used relative to its value.
2. **`sideclaw dispatch`** — near-zero (IU per-token, off Max), for a bounded episode that
   doesn't need this session's context.
3. **Background `Agent` driving workers** — moderate (a thin Max orchestrator that delegates,
   doesn't grind), for long detachable work.
4. **Foreground `Agent` on Opus** — full Max, isolated cache, for novel hard logic.
5. **Agent teams** — N× Max, only for genuinely hard parallel reasoning.

Background agents and agent teams buy *detachment and coordination*, not cheap parallelism —
they run on Max. Free-or-cheap parallelism comes from fanning out MCP worker calls, where the
orchestrator just awaits concurrent off-Max jobs.
