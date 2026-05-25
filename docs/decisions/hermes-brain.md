# Hermes Brain — Sonnet → Kimi-K2.6

**Decision:** switch the Hermes agent's default brain from `claude-sonnet-4-6` to
**`Kimi-K2.6`** served via the IU unified endpoint, with an **EU-compliant fallback** to
`claude-sonnet-4-6-eu`.

Hermes touches personal data (calendar, health, email via argo), so **EU data residency is a
hard requirement** — it gates the whole model chain, not just the primary.

## Why Kimi-K2.6 as the brain

- **EU-resident.** Kimi-K2.6 routes to Azure Sweden Central (verified via `x-ms-region`
  response header). Reasoning + function/tool calling, ~256k context. No image input.
- **Off Max quota.** Per-token IU billing keeps the brain off Anthropic Max — same economics
  as the worker tier in [kimi-bridge.md](./kimi-bridge.md).
- **Single backend → throttle-prone.** Only one backend (Sweden Central), so 429
  ("Server at maximum concurrent capacity") and occasional 5xx happen under load. This is the
  reason resilience is not optional.

## The EU-safe fallback — what NOT to pick

The fallback chain must stay EU-only, which rules out two tempting-but-wrong options:

| Model | Verdict |
|-|-|
| `claude-sonnet-4-6-eu` | **Fallback.** Routes to the GDPR-only Claude gateway over the OpenAI-compat transport. EU, 200k ctx. |
| `claude-haiku-4-5-eu` | Optional small/util model, same GDPR-only gateway, EU. |
| **Kimi-K2.5** | **Do NOT use as fallback.** Steadier (dual-backend: Nebius + Azure) but routes to US East-2 — fails the GDPR bar for personal data. |
| **native `/anthropic` Claude** | **Do NOT use.** Can route US. |

The reliability-vs-residency tension is the whole point: Kimi-K2.5 is the *more reliable*
sibling, but for a personal-data consumer, residency wins over redundancy. A US-routing model
is disqualified no matter how stable it is.

> **Note the contrast with non-personal-data contexts.** Where data residency doesn't apply
> (e.g. picking the steadiest GPT for generic OpenCode chat), backend count *is* the deciding
> factor and Kimi-K2.5 would be the sensible steadier choice over K2.6. The constraint flips
> entirely based on whether personal data is in play.

## Resilience requirements

1. Kimi-K2.6 primary over the OpenAI-compat transport.
2. On 429/5xx: exponential backoff (2–3×), then fall back to `claude-sonnet-4-6-eu`.
3. Log which model actually served each response (never the key). Keep the whole chain EU-only.
4. Verify Kimi's `tool_calls` schema matches what Hermes's skill domains expect; adjust the
   adapter if needed.
5. **Behavior shift:** Hermes was tuned on Sonnet 4.6. Re-test the skill domains and tune
   prompts where Kimi diverges (formatting, system-prompt adherence) — a model swap is not a
   drop-in for a prompt-tuned agent.

Operational specifics (credential resolution, request-layer wiring, validation skill) stay in
the hermes-agent repo and dotfiles. This record captures the *choice* and the residency
reasoning.
