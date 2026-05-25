# Kimi-K2.6 Worker Model + LiteLLM Bridge

**Decision (validated 2026-05-21):** all off-Max worker tasks (`check`, `review`, `research`,
`implement`) run on **Kimi-K2.6** served through the IU unified endpoint, reached from
`claude -p` via a local **LiteLLM proxy** that translates the Anthropic Messages API to
OpenAI Chat Completions. The fallback model is **`claude-sonnet-4-6-eu`**.

Operational wiring (LaunchAgent plist, config paths, keychain commands, master-key handling,
restart/log commands) lives in dotfiles `config/litellm/` and `litellm/`. This record is the
decision and the lessons.

## Why Kimi-K2.6

- **EU/GDPR-resident.** Kimi-K2.6 routes to Azure Sweden Central (verified via response
  headers). Worker tasks operate on repo contents, so EU residency is required.
- **Off Max quota.** Billed per-token through IU, which keeps Anthropic Max quota for the
  orchestrator. This is the whole point of the worker tier — see
  [execution-modes.md](./execution-modes.md).
- **Capable enough for the work.** Validated end-to-end on real multi-turn tool use
  (Bash → Glob/Grep → Read → answer, 5 turns, clean JSON, no translation errors).

**Tradeoff — single backend.** Kimi-K2.6 has only one backend (Sweden Central), so it is
throttle-prone: HTTP 429 "Server at maximum concurrent capacity" plus occasional 5xx under
load. This is why a fallback and backoff are mandatory, and why a global concurrency cap
queues parallel fan-out rather than letting it 429 the bridge.

## Why the LiteLLM bridge exists

The IU endpoint exposes two isolated transports:

| Route | Format | Models | Native client |
|-|-|-|-|
| `.../anthropic` | Anthropic Messages API | Claude only | `claude -p` |
| `.../openai` | OpenAI Chat Completions | All, incl. Kimi | OpenAI SDK, OpenCode |

`claude -p` speaks only the Anthropic route, and that route does **not** shim Kimi
(`claude -p` + Anthropic base URL + `kimi-k2.6` → **404**). The LiteLLM proxy is the only
documented path to get `claude -p` talking to Kimi: it accepts Anthropic `/v1/messages` and
re-emits OpenAI `/chat/completions` against the IU OpenAI route.

```
claude -p → Anthropic /v1/messages → LiteLLM proxy → OpenAI /chat/completions → IU /openai → Kimi-K2.6
```

Rejected alternatives: existing open-source wrappers (`claude-wrapper`,
`claude-code-openai-wrapper`) are all locked to Anthropic backends; the direct Moonshot key
(`api.moonshot.ai/anthropic`) works but bypasses IU and needs separate billing.

## Lessons learned — three non-obvious fixes

These were discovered during the POC and are not in any vendor spec. They are baked into the
production config; recording them here so the *reasons* survive.

1. **Model-name casing matters.** Must be `Kimi-K2.6` (capital K) exactly as the IU `/models`
   endpoint lists it. Lowercase `kimi-k2.6` → `No suitable backend server found` from the IU
   gateway. (A concrete instance of "listed ≠ callable": the casing is part of the contract.)

2. **Force Chat Completions, not the Responses API.** LiteLLM's Anthropic `/v1/messages`
   passthrough defaults to the OpenAI **Responses API** (`/v1/responses`), which IU does not
   serve for Kimi. Setting `LITELLM_USE_CHAT_COMPLETIONS_URL_FOR_ANTHROPIC_MESSAGES=true`
   forces routing to `/chat/completions`. Without it, every call fails.

3. **Drop unsupported params.** `claude -p` sends `reasoning_effort`, which Kimi rejects with
   `UnsupportedParamsError`. LiteLLM's `drop_params: true` strips it automatically.

A fourth runtime detail: `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` is needed or the IU
gateway may 400 on Anthropic beta headers.

## Caveats worth remembering

- **Prompt caching is lost in translation.** Claude Code's local accounting may *report*
  cache reads, but those are not real IU cache hits across the bridge.
- **Thinking blocks / complex tool schemas under-tested.** Basic Read/Bash/Grep/Glob loops
  are validated; reasoning-heavy prompts and complex multi-turn `Edit` patches were not
  stress-tested through the translation layer.
- **Latency.** The bridge adds a hop on top of IU routing: ~4 s TTFT for simple prompts,
  ~18 s for a 5-turn tool task. Acceptable for latency-tolerant offload, not for interactive
  work.

## Fallback chain

On 429/5xx from Kimi-K2.6: exponential backoff (2–3×), then fall back to
**`claude-sonnet-4-6-eu`** (routes to the GDPR-only Claude gateway over the OpenAI-compat
transport, 200k ctx, EU). The whole chain stays EU-only — see
[hermes-brain.md](./hermes-brain.md) for the same EU-safe fallback discipline applied to a
personal-data consumer.
