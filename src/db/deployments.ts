import type { DeploymentInsert } from "./schema.js";

/**
 * What every service actually runs, slot by slot — the truth layer.
 *
 * `stack_choice` records which model I picked for an *idea* ("the coding
 * model"). This records which model a *job* calls today, with what reasoning
 * budget, wired in which file. The two are different questions and the gap
 * between them is the whole point: `coding` is one stack row and six running
 * slots, and a stack row can have **zero** slots or, as `fast` does after the
 * 2026-09-13 rollout, more slots than any other category — see the `/stack`
 * slot-count column, which exists to expose exactly this gap.
 *
 * Every row is a claim about another repo, so every row carries `config_ref`
 * (the file that actually wires it) and `verified_at` (when that file was last
 * read and found to still say this). A row whose `verified_at` has gone stale
 * is a row nobody should trust — /stack renders it as such.
 *
 * Inactive config blocks (hermes's commented-out elevenlabs/mistral/local TTS
 * providers, audio-gateway's `.env.tpl` examples) are deliberately absent: a
 * setting that does not run is not a deployment.
 */

const VERIFIED = "2026-09-13";

export const DEPLOYMENTS: DeploymentInsert[] = [
  // ── Claude Code (dotfiles launchers, subagents, dispatch) ─────────────────
  {
    service: "claude-code",
    slot: "orchestrator-max",
    literal_id: false,
    label: "c — daily driver on Max",
    model_id: "claude-fable-5-1",
    category: "orchestrator",
    thinking: "default",
    params: "ENABLE_TOOL_SEARCH=true; API key/base blanked to force Max OAuth",
    config_ref: "dotfiles/config/zsh/claude.zsh:61",
    rationale:
      "No model pinned in the launcher — it inherits the last /model, so this records the standing choice rather than a config value. Fable 5.1 also tops the orchestrator profile and LMArena creative writing (1508.8, above claude-opus-4-6), so the algorithm and the habit agree.",
    decision_doc: "docs/decisions/execution-modes.md",
    decided_at: "2026-08-02",
    verified_at: VERIFIED,
  },
  {
    service: "claude-code",
    slot: "interactive-iu",
    // A deliberately different tier from the category winner.
    follows_recommendation: false,
    label: "ca — interactive session over the IU Anthropic route",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "high",
    params: "--effort high; all four ANTHROPIC_DEFAULT_* pinned to claude-sonnet-5[1m]",
    config_ref: "dotfiles/config/zsh/claude.zsh:228-255",
    rationale:
      "ccbench interactive pick: fastest wall clock in the 13-model field at a cost the Max plan does not charge for. ANTHROPIC_DEFAULT_HAIKU_MODEL is deliberately claude-haiku-4-5 without [1m].",
    decision_doc: "docs/decisions/claude-code-model.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "claude-code",
    slot: "subagent",
    // Runs on the Max plan, where the category's cost term is meaningless.
    follows_recommendation: false,
    literal_id: false,
    label: "every native subagent",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "default",
    params:
      "CLAUDE_CODE_SUBAGENT_MODEL=sonnet; hooks/model-discipline.ts denies worker-on-Fable and fork-from-Fable/Opus",
    config_ref: "dotfiles/config/settings.template.json:4",
    rationale:
      "Settled work does not buy judgment from a bigger model. The pin is enforced by a PreToolUse hook rather than convention.",
    decision_doc: "docs/decisions/execution-modes.md",
    decided_at: "2026-08-02",
    verified_at: VERIFIED,
  },
  {
    service: "claude-code",
    slot: "worker-dispatch",
    // ccbench governs this role, not the leaderboard-scored `coding` profile.
    // glm-5.3-flash is not a smaller glm-5.3 — it is a separately trained
    // 320B-A18B base that Z.ai positions for agentic/tool-calling coding, at
    // 9x less in and 8.8x less out with 2x the decode rate. 0.966 over 46
    // graded ccbench runs; glm-5.3 has never been run at all.
    // See docs/decisions/claude-code-model.md.
    follows_recommendation: false,
    label: "agent-dispatch — unattended local worker",
    model_id: "glm-5.3-flash",
    category: "coding",
    thinking: "default",
    params:
      "ANTHROPIC_MODEL + all four ANTHROPIC_DEFAULT_*; API_TIMEOUT_MS=3000000; context 1M via _ca_ctx; MAX_THINKING_TOKENS 8192 via _ca_thinking (config/zsh/iu-models.sh:38)",
    config_ref: "dotfiles/scripts/agent-dispatch.sh:177,196",
    rationale:
      "ccbench unattended-worker pick: 10/10 on every task at 32x less than claude-sonnet-5, once the per-task clock stops being the experiment. Requesty hop, residency 'global' — non-sensitive code only. Implementation work now defaults to sideclaw dispatch (config/global.CLAUDE.md) rather than this launcher for live-tree edits. NOTE: dotfiles/CLAUDE.md:213 still claims this is claude-sonnet-5[1m]; the code is the truth.",
    decision_doc: "docs/decisions/claude-code-model.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "claude-code",
    slot: "wave",
    // Runs on the Max plan, where the category's cost term is meaningless.
    follows_recommendation: false,
    literal_id: false,
    label: "rd wave — self-continuing pane chain",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "default",
    params: "RD_WAVE_MODEL=sonnet",
    config_ref: "dotfiles/scripts/remote-dev.sh:488",
    rationale:
      "Runs on the Max plan through herdr panes, so the ccbench cost argument does not apply.",
    decision_doc: "docs/decisions/execution-modes.md",
    decided_at: "2026-08-02",
    verified_at: VERIFIED,
  },
  {
    service: "claude-code",
    slot: "bg",
    // Runs on the Max plan, where the category's cost term is meaningless.
    follows_recommendation: false,
    literal_id: false,
    label: "rd bg — steerable background colleague",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "default",
    params: "RD_BG_MODEL=sonnet",
    config_ref: "dotfiles/scripts/remote-dev.sh:581",
    rationale: "Same Max-plan argument as the wave lane.",
    decision_doc: "docs/decisions/execution-modes.md",
    decided_at: "2026-08-02",
    verified_at: VERIFIED,
  },
  {
    service: "claude-code",
    slot: "analyze",
    // A deliberately different tier from the category winner.
    follows_recommendation: false,
    label: "/analyze — fallow static-analysis subprocess",
    model_id: "claude-haiku-4-5",
    category: "fast",
    thinking: "n/a",
    params: "via claude_iu",
    config_ref: "dotfiles/skills/analyze/SKILL.md:127",
    rationale:
      "Summarising a tool's structured output — the cheapest tier that reads a report reliably.",
    decision_doc: null,
    decided_at: "2026-06-17",
    verified_at: VERIFIED,
  },
  {
    service: "claude-code",
    slot: "second-opinion",
    label: "cx — Codex second opinion",
    model_id: "gpt-5.6-sol",
    category: null,
    thinking: "high",
    params: 'model_reasoning_effort="high", summary auto, verbosity medium',
    config_ref: "dotfiles/config/codex/config.toml.tpl:19-23",
    rationale:
      "Structural, not scored: the point is a non-Anthropic reading, so no category recommendation applies. Responses-only wire protocol is why Codex is the harness.",
    decision_doc: null,
    decided_at: "2026-08-02",
    verified_at: VERIFIED,
  },
  {
    service: "claude-code",
    slot: "second-opinion-max",
    label: "cxa / astra — strongest single shot available",
    model_id: "gpt-6-astra",
    category: null,
    thinking: "max",
    params:
      'reasoning.effort xhigh; astra.sh additionally sends reasoning.mode="pro", max_output_tokens 32000',
    config_ref: "dotfiles/scripts/astra.sh:27,93,95",
    rationale:
      "Structural. reasoning.mode='pro' is sent nowhere else and no coding harness can send it — that is the entire reason this slot exists.",
    decision_doc: null,
    decided_at: "2026-08-02",
    verified_at: VERIFIED,
  },

  // ── sideclaw ──────────────────────────────────────────────────────────────
  {
    service: "sideclaw",
    slot: "check",
    // CLASSIFY moved off glm-5.3-flash 2026-09-23 (GLM retired from this
    // server entirely) onto DeepSeek-V4-Flash — the same in-loop-speed
    // complaint that moved dispatch off glm applies here too, plus glm
    // stalling an 84-minute dispatch episode on 2026-09-15. No separate
    // CLASSIFY-tier measurement was run: this is the id dispatch's old AGENT
    // tier already carried, at a lower thinking budget, on easier work.
    follows_recommendation: false,
    label: "check — format · lint · tsc · test (CLASSIFY tier)",
    model_id: "DeepSeek-V4-Flash",
    category: "coding",
    thinking: "default",
    params:
      "backend iu; fallback claude-haiku-4-5 on max; transport session; thinkingTokens 2048 (MAX_THINKING_TOKENS, the only effort control on this leg); override SIDECLAW_THINKING_TOKENS_CHECK",
    config_ref: "sideclaw/server/lib/routing.ts:281-288,312",
    rationale:
      "Reading tool output and deciding pass/fail — the cheapest tier that holds an agent loop. 2026-09-23: moved off glm-5.3-flash (GLM retired) onto DeepSeek-V4-Flash; thinkingTokens stays capped at 2048 so a classify-shaped call can't default to a gateway model's uncapped `max` reasoning.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-23",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "overview",
    // CLASSIFY moved off glm-5.3-flash 2026-09-23 (GLM retired) onto
    // DeepSeek-V4-Flash — see the check row's comment for the evidence.
    follows_recommendation: false,
    label: "overview (CLASSIFY tier)",
    model_id: "DeepSeek-V4-Flash",
    category: "coding",
    thinking: "default",
    params:
      "backend iu; fallback claude-haiku-4-5 on max; thinkingTokens 2048; override SIDECLAW_THINKING_TOKENS_OVERVIEW",
    config_ref: "sideclaw/server/lib/routing.ts:281-288,313",
    rationale: "Same CLASSIFY tier as check.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-23",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "review_router",
    // CLASSIFY moved off glm-5.3-flash 2026-09-23 (GLM retired) onto
    // DeepSeek-V4-Flash — see the check row's comment for the evidence.
    follows_recommendation: false,
    label: "review_router (CLASSIFY tier)",
    model_id: "DeepSeek-V4-Flash",
    category: "coding",
    thinking: "default",
    params:
      "backend iu; fallback claude-haiku-4-5 on max; thinkingTokens 2048; override SIDECLAW_THINKING_TOKENS_REVIEW_ROUTER",
    config_ref: "sideclaw/server/lib/routing.ts:281-288,314",
    rationale: "Same CLASSIFY tier as check.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-23",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "review",
    // Runs on the Max plan, where the category's cost term is meaningless.
    follows_recommendation: false,
    label: "review — multi-angle code review (JUDGE tier)",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "default",
    params: "backend max (fallback: same model on iu); [1m] context",
    config_ref: "sideclaw/server/lib/routing.ts:289-295,316",
    rationale:
      "Judging a diff is the one sideclaw job where a miss is expensive and the Max plan charges nothing — so it does not follow the cheap CLASSIFY tier.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "narrative",
    // A deliberately different tier from the category winner.
    follows_recommendation: false,
    label: "narrative (PROSE tier)",
    model_id: "claude-sonnet-5",
    category: "writing",
    thinking: "default",
    params: "backend max; fallback same model on iu",
    config_ref: "sideclaw/server/lib/routing.ts:296-302,315",
    rationale:
      "Prose tier. Note the writing stack pick is claude-opus-4-6 — this slot deliberately runs a cheaper model because the output is a summary, not authored prose.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "adversary",
    label: "adversary — finding verification",
    model_id: "gpt-5.6-terra",
    category: null,
    thinking: "default",
    params: "backend iu; NO fallback; transport iu-openai (direct fetch, never runSession)",
    config_ref: "sideclaw/server/lib/routing.ts:329-335",
    rationale:
      "Structural, not scored: the value is that it is a different family from the model that produced the finding. No category recommendation can express 'not the same vendor'.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "review_ocr",
    // Second, larger bake-off 2026-09-25 on the same range (sideclaw 819bcc7..4898afb,
    // every finding checked by hand). ocr wall time = LLM rounds x ~5 s per round, equal
    // across models, so tok/s barely matters. At ocr's default effort (2 review passes)
    // v4.1-flash explored 117 rounds / 6m30s; with `--effort low` 3 runs took 2m31s-3m09s
    // with 4-7 findings, nearly all real, and the most cross-file/config catches.
    // gpt-5.6-luna 3x 1m39s-1m53s (4-6 real, overlaps the angle reviewers); gpt-6-luna 3x
    // ~1m30s (2-3 real); gemini-3.8-flash 2x ~7m (84 rounds at a 3.3 s IU TTFT).
    follows_recommendation: false,
    label: "review_ocr — alibaba/open-code-review input to review",
    model_id: "deepseek-v4.1-flash",
    category: null,
    thinking: "default",
    params:
      "backend iu; NO fallback; transport external-iu (the `ocr` CLI over IU's OpenAI chat route, ocrProtocolFor); ocr --effort low; override SIDECLAW_MODEL_REVIEW_OCR",
    config_ref: "sideclaw/server/lib/routing.ts:317-335",
    rationale:
      "Structural: measured inside ocr's own tool loop, which no leaderboard scores. v4.1-flash at --effort low finds the cross-file and config drift the Sonnet angle reviewers miss, in ~2.5-3 min, parallel to the angle phase.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-25",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "dispatch",
    // Investigate/author tier only — implement runs the same route at a
    // higher reasoning_effort variant, see the dispatch_implement row below.
    follows_recommendation: false,
    label: "dispatch — investigate/author episode in a named repo (AGENT_OC tier)",
    model_id: "deepseek-v4.1-flash",
    category: "coding",
    thinking: "high",
    params:
      "backend iu; fallback claude-sonnet-5[1m] on max (a fallback attempt always runs the claude harness, never opencode); harness opencode (opencode run, NOT claude -p — this id has no code path through claude -p at all); variant high (opencode's reasoning-effort knob; MAX_THINKING_TOKENS has no effect on this harness); override SIDECLAW_MODEL_DISPATCH / SIDECLAW_HARNESS_DISPATCH / SIDECLAW_VARIANT_DISPATCH",
    config_ref: "sideclaw/server/lib/routing.ts:237-244,336",
    rationale:
      "2026-09-24: moved off DeepSeek-V4-Flash on claude -p (the retired AGENT tier) onto OpenCode running deepseek-v4.1-flash over the IU OpenAI-compatible route — a different id and transport claude -p cannot reach at all. Evidence: three implement briefs re-run from DeepSeek-V4-Pro's base commits favored OpenCode on cost by 1-2 orders of magnitude (vps $0.06/5min vs $2.46/10min; research-gateway #21 $0.10/5min vs $11.01/28min; weatherorb $0.06/5min vs $5.39/21min), and a blind diff review preferred OpenCode's output on 2 of 3 (lost vps: inverted volume-floor logic in a HyperDX config — not a clean sweep, recorded honestly). Cache hits 95-98% on this route vs 8% for V4-Pro on the Anthropic route.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-24",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "dispatch_implement",
    // Shares AGENT_OC's model/route/evidence with dispatch above; only the
    // reasoning_effort variant differs for the higher-stakes write tier.
    follows_recommendation: false,
    label: "dispatch_implement — write episode in a named repo (AGENT_OC_IMPLEMENT tier)",
    model_id: "deepseek-v4.1-flash",
    category: "coding",
    thinking: "max",
    params:
      "backend iu; fallback claude-sonnet-5[1m] on max (a fallback attempt always runs the claude harness, never opencode); harness opencode (opencode run, NOT claude -p); variant max (opencode's reasoning-effort knob, one step above dispatch's 'high'); override SIDECLAW_MODEL_DISPATCH_IMPLEMENT / SIDECLAW_HARNESS_DISPATCH_IMPLEMENT / SIDECLAW_VARIANT_DISPATCH_IMPLEMENT",
    config_ref: "sideclaw/server/lib/routing.ts:245-252,337",
    rationale:
      "2026-09-24: split off dispatch's AGENT_OC tier onto its own AGENT_OC_IMPLEMENT tier for the higher-stakes write path, mirroring the old AGENT_IMPLEMENT split — same model and route as dispatch, variant raised from 'high' to 'max'. See the dispatch row above for the underlying cost/quality evidence; this tier shares it rather than repeating a separate measurement.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-24",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "otel",
    // Runs on the Max plan, where the category's cost term is meaningless.
    follows_recommendation: false,
    label: "otel — observability queries (JUDGE tier, synchronous)",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "default",
    params:
      "backend max; runs inline via runSession, never queued — the one tool exempt from the job contract",
    config_ref: "sideclaw/server/lib/routing.ts:289-295,338",
    rationale: "Interactive debugging: a jobId round-trip would cost more than the query.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "excalidraw",
    label: "excalidraw_diagram (PROSE tier)",
    model_id: "claude-sonnet-5",
    category: null,
    thinking: "default",
    params: "backend max; fallback same model on iu",
    config_ref: "sideclaw/server/lib/routing.ts:296-302,339",
    rationale:
      "Structural: generating valid Excalidraw JSON is a format-fidelity job no category scores.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "read_image",
    label: "read_image (VISION tier)",
    model_id: "gemini-3.5-flash",
    category: null,
    thinking: "n/a",
    params: "backend iu; NO fallback; transport iu-openai",
    config_ref: "sideclaw/server/lib/routing.ts:303-309,340",
    rationale:
      "Vision is a manual stack category — no leaderboard scores document/diagram reading, so there is no algorithmic recommendation to drift against.",
    decision_doc: "docs/decisions/vision-and-image.md",
    decided_at: "2026-06-17",
    verified_at: VERIFIED,
  },
  {
    service: "sideclaw",
    slot: "read_drawing",
    label: "read_drawing (VISION tier)",
    model_id: "gemini-3.5-flash",
    category: null,
    thinking: "n/a",
    params: "backend iu; NO fallback; transport iu-openai",
    config_ref: "sideclaw/server/lib/routing.ts:303-309,341",
    rationale: "Same VISION tier as read_image.",
    decision_doc: "docs/decisions/vision-and-image.md",
    decided_at: "2026-06-17",
    verified_at: VERIFIED,
  },

  // ── warden ────────────────────────────────────────────────────────────────
  {
    service: "warden",
    slot: "investigate",
    // ccbench governs this role, not the leaderboard-scored `coding` profile.
    // glm-5.3-flash is not a smaller glm-5.3 — it is a separately trained
    // 320B-A18B base that Z.ai positions for agentic/tool-calling coding, at
    // 9x less in and 8.8x less out with 2x the decode rate. 0.966 over 46
    // graded ccbench runs; glm-5.3 has never been run at all.
    // See docs/decisions/claude-code-model.md.
    follows_recommendation: false,
    label: "auto investigate episode",
    model_id: "glm-5.3-flash",
    category: "coding",
    thinking: "default",
    params: "TRIAGE_AUTO_DISPATCH_MODEL; guard warns if a Claude id is set",
    config_ref: "warden/scripts/triage.py:1176,3036",
    rationale:
      "Unattended work on a ledger — the ccbench worker pick, for the ccbench worker reasons.",
    decision_doc: "docs/decisions/claude-code-model.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "warden",
    slot: "implement",
    // ccbench governs this role, not the leaderboard-scored `coding` profile.
    // glm-5.3-flash is not a smaller glm-5.3 — it is a separately trained
    // 320B-A18B base that Z.ai positions for agentic/tool-calling coding, at
    // 9x less in and 8.8x less out with 2x the decode rate. 0.966 over 46
    // graded ccbench runs; glm-5.3 has never been run at all.
    // See docs/decisions/claude-code-model.md.
    follows_recommendation: false,
    label: "auto implement episode",
    model_id: "glm-5.3-flash",
    category: "coding",
    thinking: "default",
    params: "TRIAGE_AUTO_DISPATCH_MODEL (same knob as investigate)",
    config_ref: "warden/scripts/triage.py:1176,4894",
    rationale: "Same knob, same reasoning as the investigate phase.",
    decision_doc: "docs/decisions/claude-code-model.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "warden",
    slot: "review",
    // Runs on the Max plan, where the category's cost term is meaningless.
    follows_recommendation: false,
    literal_id: false,
    label: "step-7 review validation",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "default",
    params:
      "TRIAGE_VALIDATION_DISPATCH_MODEL is deliberately unset — falls through to sideclaw's JUDGE tier (claude-sonnet-5[1m] on max)",
    config_ref: "warden/scripts/triage.py:1207,4965",
    rationale:
      "Unset on purpose so the gate inherits sideclaw's JUDGE routing rather than pinning a second copy of it. Changing sideclaw's JUDGE tier silently changes this slot.",
    decision_doc: "docs/decisions/sideclaw-tiers.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "warden",
    slot: "propose-mappings",
    label: "propose_mappings — single chat_completions call",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "chat_completions only (/responses 404s); reasoning_effort high; max_completion_tokens 16000 (not 2000 — this model's thinking expands to fill the budget and returns empty below ~1000); no temperature",
    config_ref: "warden/scripts/triage.py:1122-1165,5880",
    rationale:
      "2026-09-13 estate-wide rollout: `fast` moved to deepseek-v4.1-flash at reasoning_effort high. A once-a-day batched maintenance call, not latency-sensitive, so there is no reason to trade quality for speed here.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },

  // ── hermes ────────────────────────────────────────────────────────────────
  {
    service: "hermes",
    slot: "brain",
    // The `fast` recommender still names gpt-5.6-luna (see fast-model.md) — this
    // is an explicit owner override, not an unnoticed drift.
    follows_recommendation: false,
    label: "brain — the agent loop",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "agent.reasoning_effort=high (config.yaml:77); api_mode chat_completions (not /responses — 404s 'No suitable backend' despite /models listing it); the load-bearing key is providers.custom.api_mode (config.yaml:28), NOT the top-level model.api_mode (:9) — resolve_runtime_provider() reads api_mode from the named-provider block only, so without :28 it falls through to codex_responses, DeepSeek 404s, and the brain silently fails over to gpt-5.6-luna every turn (confirmed live 2026-09-13); tool_use_enforcement true; context_length 850000; max_turns 90",
    config_ref: "hermes-agent/config.yaml:3,9,28,77",
    rationale:
      "2026-09-13 owner decision: capability over cost (docs/decisions/hermes-brain.md §2026-09-13), overriding the recommender's Luna pick. V4.1 tops Luna's ceiling (39.5 vs 37.5 AA intelligence at max effort) and consolidates one model across every mid-size lane in the estate, at the accepted cost of — as understood at the time — no prompt caching on this route (~$0.85 vs Luna's ~$0.06 per 90-turn conversation, measured 2026-09-12). Live-probed the same day: function tools + reasoning_effort:high survive together on chat_completions. CORRECTION 2026-09-24: caching does in fact work on this IU OpenAI-compatible route — a direct probe re-sending a 7780-token prefix got cached_tokens 7552, cost per call falling from $0.0011682 to $0.000058 (gateway rates $0.15/MTok in, $0.60 out, ~$0.003 cache read). The 2026-09-12 measurement was wrong, not the decision it fed into: V4.1 was still the pick on capability grounds regardless of the cache figure.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "hermes",
    slot: "brain-fallback",
    label: "brain failover provider",
    model_id: "gpt-6-luna",
    category: null,
    thinking: "off",
    params:
      "api_mode chat_completions; context_length 850000; the transport patch sends an explicit reasoning_effort none whenever tools are present (Hermes always sends tools) — gpt-6-luna 503s on tools with ANY effort key, including an absent one, unlike gpt-5.6-luna which accepted the stripped key",
    config_ref: "hermes-agent/config.yaml:25-27",
    rationale:
      "Structural: a different vendor than the brain (gpt-6.x vs DeepSeek), same IU OpenAI leg, cached — chosen so a brain outage doesn't take out the whole path. Moved off the EU-pinned claude-sonnet-4-6-eu on the 2026-09-13 rollout, dropping the region guarantee that pick carried — see hermes-brain.md. 2026-09-23: gpt-5.6-luna -> gpt-6-luna (~4x faster decode, half the price); fallback turn live-verified with 100% cache reads.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-09-23",
    verified_at: "2026-09-23",
  },
  {
    service: "hermes",
    slot: "compression",
    // Same override as brain — the recommender still names gpt-5.6-luna for `fast`.
    follows_recommendation: false,
    label: "context compression",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "api_mode chat_completions, reasoning_effort high, context_length 850000 (load-bearing: the aux model's own context_length clamps the 240k compaction trigger). NO max_tokens by design — context_compressor.py:646 forbids a wire cap, a truncated summary poisons the whole downstream session.",
    config_ref: "hermes-agent/config.yaml:204-217",
    rationale:
      "2026-09-13 rollout moved this off gpt-5.6-luna onto the estate default, same owner decision as brain. The earlier rejection (deepseek-v4.1-flash starving at an 8k budget on five of six long-generation attempts) does not apply here — this slot deliberately carries no output cap, which is exactly what that failure mode needed.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "hermes",
    slot: "approval-classifier",
    // Residency-gated — the category winner is not region-verified.
    follows_recommendation: false,
    label: "approval classifier",
    model_id: "claude-haiku-4-5",
    category: "fast",
    thinking: "n/a",
    params:
      "api_mode anthropic_messages; context 200000; temperature=0 hardcoded in approval_smart.py",
    config_ref: "hermes-agent/config.yaml:224-240",
    rationale:
      "A deterministic yes/no gate — temperature 0, cheapest tier that classifies reliably.",
    decision_doc: null,
    decided_at: "2026-06-17",
    verified_at: VERIFIED,
  },
  {
    service: "hermes",
    slot: "title",
    label: "conversation title generation",
    model_id: "gpt-6-luna",
    category: "fast",
    thinking: "off",
    params:
      "api_mode chat_completions; config says reasoning_effort low but title_generator passes reasoning_config enabled:false, so the wire carries none; no temperature on the wire (patches/auxiliary-client-iu-openai-leg-quirks.patch covers gpt-5.x and gpt-6.x)",
    config_ref: "hermes-agent/config.yaml:223-229",
    rationale:
      "Moved off gemini-2.5-flash-lite in the 2026-09-13 rollout — follows the estate's small-latency-critical-call tier (fast-model.md). 2026-09-23: gpt-5.6-luna -> gpt-6-luna.",
    decision_doc: "docs/decisions/fast-model.md",
    decided_at: "2026-09-23",
    verified_at: "2026-09-23",
  },
  {
    service: "hermes",
    slot: "vision",
    label: "vision auxiliary",
    model_id: "gemini-3.5-flash",
    category: null,
    thinking: "n/a",
    params: "provider custom, IU OpenAI leg (api_mode chat_completions); timeout 120",
    config_ref: "hermes-agent/config.yaml:196-203",
    rationale:
      "Manual category. Moved off the direct-Google gemini-2.5-flash aux client onto the IU OpenAI leg on gemini-3.5-flash, matching sideclaw's read_image pick — closes the undeliberate split this row used to flag.",
    decision_doc: "docs/decisions/vision-and-image.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "hermes",
    slot: "x-search",
    label: "x_search",
    model_id: "grok-4.20-reasoning",
    category: null,
    thinking: "default",
    params: "timeout 180; retries 2",
    config_ref: "hermes-agent/config.yaml:666-667",
    rationale:
      "Structural: an xAI-direct pin, not on the IU endpoint and not in this catalog, because it is the only model with X corpus access. No decision doc backs it.",
    decision_doc: null,
    decided_at: "2026-06-17",
    verified_at: VERIFIED,
  },
  {
    service: "hermes",
    slot: "delegation",
    // Inherits the brain's model, which currently differs from the `fast` recommendation.
    follows_recommendation: false,
    literal_id: false,
    label: "delegated children",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "default",
    params:
      "model '' and reasoning_effort '' — both inherit the brain; child_timeout_seconds 0; max_iterations unlimited (sys.maxsize); max_concurrent_children 10; max_spawn_depth 1",
    config_ref: "hermes-agent/config.yaml:419-438",
    rationale: "Inherits the brain by design, so a brain change propagates without a second edit.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "hermes",
    slot: "tts",
    // audio-stack.md measured the category winner at ~10s per reply once its
    // prep LLM is counted; this path streams into TTS sentence by sentence.
    follows_recommendation: false,
    label: "voice replies",
    model_id: "elevenlabs/flash-v2.5",
    category: "tts",
    thinking: "n/a",
    params:
      "voice Mark; via audio-gateway.jkrumm.com/v1; speed 1; max_text_length 32000. NOT elevenlabs/v3 — that is the podcast lane (audio/podcast-tts). There is no `flash-v3` on the IU Replicate route: it serves flash-v2.5, turbo-v2.5, v2-multilingual and v3 only (live catalog refresh 2026-09-12).",
    config_ref: "hermes-agent/config.yaml:343-349",
    rationale:
      "~1.2s per reply against ~10s on Gemini TTS once the prep LLM is counted; replies stream sentence-by-sentence so per-request latency is what the ear hears. US-routed, accepted for generated reply text.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-08-26",
    verified_at: VERIFIED,
  },
  {
    service: "hermes",
    slot: "stt",
    label: "voice input transcription",
    model_id: "gpt-4o-transcribe",
    category: "stt",
    thinking: "n/a",
    params: "via audio-gateway",
    config_ref: "hermes-agent/config.yaml:371-374",
    rationale:
      "Most accurate IU STT. Residency requirement is eu because this slot carries recorded voice, which audio-stack.md does not accept on a US route — the route's actual region is unverified, so this row is a live tension, not a settled pick.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-05-25",
    verified_at: VERIFIED,
  },

  // ── research-gateway ──────────────────────────────────────────────────────
  {
    service: "research",
    slot: "lead",
    // 2026-09-13 owner override — the `fast` recommender still names gpt-5.6-luna.
    follows_recommendation: false,
    label: "lead — plan + synthesis",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "IU_LEAD_MODEL; reasoning_effort high and per-role output budgets (plan 8000 / synthesis 32000) in lib/llm-settings.ts:16,18; consumed in agent/plan.ts, agent/synthesize.ts",
    config_ref: "research-gateway/src/env.ts:19",
    rationale:
      "Off Max by design. env.ts:9-11 documents the failure this replaced: a dead IU_MODEL var still set to DeepSeek-V4-Pro was read as the lead long after it was not. 2026-09-13: moved onto the estate-wide deepseek-v4.1-flash default per the owner's capability-over-cost decision (hermes-brain.md §2026-09-13), superseding the 2026-08-20 move to gpt-5.6-luna.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "research",
    slot: "worker",
    // Same override as lead — one role, one model.
    follows_recommendation: false,
    label: "worker — page fetch + extraction",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "IU_WORKER_MODEL; reasoning_effort high; WORKER_MAX_CONCURRENCY=8; per-call output budget 16000 (workerStep, lib/llm-settings.ts:17)",
    config_ref: "research-gateway/src/env.ts:20",
    rationale: "Eight concurrent workers make per-call cost and TTFT the binding constraints.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },

  // ── audio-gateway ─────────────────────────────────────────────────────────
  {
    service: "audio",
    slot: "tts-default",
    // A deliberately different tier from the category winner.
    follows_recommendation: false,
    label: "/audio/speech default",
    model_id: "gemini-3.1-flash-tts-preview",
    category: "tts",
    thinking: "n/a",
    params: "gateway owns the choice; a caller's model id is remapped (model-resolution.ts:56-62)",
    config_ref: "audio-gateway/src/config.ts:142",
    rationale:
      "The gateway default for callers that name nothing. Deliberately NOT the tts stack pick — Hermes overrides to elevenlabs/flash-v2.5 per request, so the stack pick and this default legitimately differ.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-08-26",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "stt-default",
    label: "/audio/transcriptions default",
    model_id: "gpt-4o-transcribe",
    category: "stt",
    thinking: "n/a",
    params: "allowlist: whisper, gpt-4o-transcribe, gpt-4o-mini-transcribe; anything else remapped",
    config_ref: "audio-gateway/src/config.ts:150",
    rationale: "Whisper is kept only for timestamps/verbose_json, which gpt-4o-transcribe rejects.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-05-25",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "tts-prep",
    label: "TTS text-prep LLM",
    model_id: "gpt-6-luna",
    category: "fast",
    thinking: "low",
    params:
      "ttsPrepEffort low (config.ts:217, no tools so the gpt-6-luna tools+effort rejection cannot trigger); consumed by gemini-tts.ts and replicate-tts.ts via config.ttsPrepModel; prep runs only for allowlisted models (elevenlabs/v3)",
    config_ref: "audio-gateway/src/config.ts:209",
    rationale:
      "The prep pass is why Gemini TTS measured ~10s per reply end to end — it is counted against the TTS latency, not hidden behind it. 2026-09-23: gpt-5.6-luna -> gpt-6-luna; live prep rows 2.0-2.4s on vps and mini, engine tbt 5 ms.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-09-23",
    verified_at: "2026-09-23",
  },
  {
    service: "audio",
    slot: "tts-summary",
    // A deliberately different tier from the category winner.
    follows_recommendation: false,
    label: "TTS summary LLM (latency path)",
    model_id: "gemini-3.5-flash-lite",
    category: "fast",
    thinking: "n/a",
    params: "latency-optimised path",
    config_ref: "audio-gateway/src/config.ts:216",
    rationale:
      "Flash-Lite spends zero thinking tokens, which is the whole point on a latency path.",
    decision_doc: "docs/decisions/iu-vs-ai-studio.md",
    decided_at: "2026-09-04",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "podcast-write",
    label: "podcast script writing — the voice owner",
    model_id: "claude-opus-4-6",
    category: "writing",
    thinking: "default",
    params: "used by podcasts.ts:664",
    config_ref: "audio-gateway/src/config.ts:391",
    rationale:
      "The one slot the writing category actually scores. Arena's 12,678 human votes put Opus 4.6 at #2; EQ-Bench ranks it ~18 places lower on a Claude-judged rubric and is not the signal used.",
    decision_doc: "docs/decisions/writing-model.md",
    decided_at: "2026-09-11",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "podcast-outline",
    // 2026-09-13 owner override — the `fast` recommender still names gpt-5.6-luna.
    follows_recommendation: false,
    label: "podcast outline",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "podcastOutlineEffort=high via resolveReasoningEffort; used by podcasts.ts:664 (write: :665). NOTE .env.tpl:65 shows a commented claude-opus-5 example — not the live value.",
    config_ref: "audio-gateway/src/config.ts:392,394",
    rationale:
      "Structure, not prose — moved off the writing tier deliberately. 2026-09-13: moved off gpt-5.6-luna onto the estate default per the owner's capability-over-cost decision (hermes-brain.md §2026-09-13).",
    decision_doc: "docs/decisions/podcast-writer.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "podcast-review",
    label: "podcast review panel",
    model_id: "gemini-3.8-flash,deepseek-v4.1-flash",
    category: null,
    thinking: "high",
    params:
      "PODCAST_REVIEW_MODELS csv, every role runs on every listed model; podcastReviewEffort=high via resolveReasoningEffort (deepseek-v4.1-flash accepts it; gemini-3.8-flash on this leg omits it regardless). 2026-09-13: gpt-5.6-luna swapped for deepseek-v4.1-flash in the panel.",
    config_ref: "audio-gateway/src/config.ts:408,414",
    rationale:
      "Structural: a panel is valuable because its members disagree, so 'the best model' is the wrong question and no category scores it.",
    decision_doc: "docs/decisions/podcast-writer.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "podcast-editorial",
    // 2026-09-13 owner override — the `fast` recommender still names gpt-5.6-luna.
    follows_recommendation: false,
    label: "podcast editorial pass",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params: "moved off Opus deliberately; podcastEditorialEffort=high via resolveReasoningEffort",
    config_ref: "audio-gateway/src/config.ts:501,503",
    rationale:
      "Editorial checks are mechanical; the authored-prose model is podcast-write. 2026-09-13: moved off gpt-5.6-luna onto the estate default, same owner decision as the outline pass.",
    decision_doc: "docs/decisions/podcast-writer.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "podcast-research",
    // 2026-09-13 owner override — the `fast` recommender still names gpt-5.6-luna.
    follows_recommendation: false,
    label: "podcast research pass",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "moved off gpt-5.6-terra 2026-09-13 (OpenAI leg, reasoning_effort high, function tools alongside it — live-probed to accept both together, unlike gpt-5.6-luna); output budget 32000 (podcast-research.ts:476)",
    config_ref: "audio-gateway/src/config.ts:492,494",
    rationale:
      "Tool-calling researcher (brain search/read, past episodes, research gateway). 2026-09-13: moved off gpt-5.6-terra onto the estate default, same owner decision as the other podcast passes.",
    decision_doc: "docs/decisions/podcast-writer.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "podcast-metadata",
    // 2026-09-13 owner override — the `fast` recommender still names gpt-5.6-luna.
    follows_recommendation: false,
    label: "podcast metadata",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params: "podcastMetadataEffort=high via resolveReasoningEffort",
    config_ref: "audio-gateway/src/config.ts:416,418",
    rationale:
      "Chapters, titles, descriptions — a structured-output job. 2026-09-13: moved off gpt-5.6-luna onto the estate default, same owner decision as the other podcast passes.",
    decision_doc: "docs/decisions/podcast-writer.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "podcast-tts",
    // A deliberately different tier from the category winner.
    follows_recommendation: false,
    label: "podcast narration",
    model_id: "elevenlabs/v3",
    category: "tts",
    thinking: "n/a",
    params: "prep LLM pass applies (allowlisted at config.ts:284)",
    config_ref: "audio-gateway/src/config.ts:404",
    rationale:
      "The long-form lane: AA #5, audio tags, previous/next_text continuity. flash-v2.5 takes the chat lane where per-request latency is what the ear hears.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-08-26",
    verified_at: VERIFIED,
  },

  // ── argo · image-gen · rb · homelab ───────────────────────────────────────
  {
    service: "argo",
    slot: "ai-gateway",
    // 2026-09-13 owner override — the `fast` recommender still names gpt-5.6-luna.
    follows_recommendation: false,
    label: "/ai/v1/* — titling + classification",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "DEEPSEEK_MODEL + DEEPSEEK_REASONING_EFFORT=high; env var name was a rename-debt artifact when this ran gpt-5.6-luna, now accidentally accurate again since the slot moved back onto DeepSeek. vps override removed — one value for local + prod.",
    config_ref: "argo/apps/api/src/env.ts:93,97",
    rationale:
      "2026-09-13: moved off gpt-5.6-luna onto the estate default per the owner's capability-over-cost decision (hermes-brain.md §2026-09-13).",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "image-gen",
    slot: "enhance",
    // 2026-09-13 owner override — the `fast` recommender still names gpt-5.6-luna.
    follows_recommendation: false,
    label: "/enhance prompt-plan brain",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "ENHANCE_MODEL + ENHANCE_REASONING_EFFORT=high; max_completion_tokens 16000 (lib/enhance.ts:314). Was the bare `gpt-5.6` alias, pinned to a concrete id 2026-09-12 so the tier cannot change server-side; moved sol -> luna -> deepseek-v4.1-flash as the estate default settled.",
    config_ref: "image-gen/gateway/src/env.ts:23,25",
    rationale:
      "2026-09-13: moved onto the estate default per the owner's capability-over-cost decision (hermes-brain.md §2026-09-13) — expanding a brief into a structured JSON plan is mid-size, multi-field, single-shot work, the settled DeepSeek lane rather than the small/latency-critical lane luna covers.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-09-13",
    verified_at: VERIFIED,
  },
  {
    service: "image-gen",
    slot: "generate",
    label: "image generation family",
    model_id: "gpt-image-2.5-flare",
    category: null,
    thinking: "n/a",
    params:
      "DEFAULT_MODEL; its sibling gpt-image-2.5-sunburst serves the finals — model auto routes in shared/src/rules.ts: edits and high/xhigh/max generates -> sunburst, low/medium/auto -> flare; legacy gpt-image-2 requests routed like auto",
    config_ref: "image-gen/shared/src/contract.ts:31",
    rationale:
      "2026-09-23: gpt-image-2 retired from the generate path. The two 2.5 models price and tokenize identically and trade latency only (flare high 20s vs sunburst 32s; flare streams no partials). 2.5 high costs ~$0.053, about 4x less than gpt-image-2 high; both support real alpha transparency, which gpt-image-2 lacked.",
    decision_doc: "docs/decisions/vision-and-image.md",
    decided_at: "2026-09-23",
    verified_at: "2026-09-23",
  },
  {
    service: "rb",
    slot: "enrichment",
    // A deliberately different tier from the category winner.
    follows_recommendation: false,
    label: "enrichment LLM",
    model_id: "claude-haiku-4-5",
    category: "fast",
    thinking: "n/a",
    params: "RB_LLM_MODEL",
    config_ref: "rb/apps/api/src/env.ts:68",
    rationale:
      "High-volume structured enrichment — cheapest Claude tier, escalating only when it fails.",
    decision_doc: null,
    decided_at: "2026-06-17",
    verified_at: VERIFIED,
  },
  {
    service: "rb",
    slot: "enrichment-escalation",
    // Runs on the Max plan, where the category's cost term is meaningless.
    follows_recommendation: false,
    label: "enrichment escalation",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "default",
    params: "RB_LLM_ESCALATION_MODEL",
    config_ref: "rb/apps/api/src/env.ts:69",
    rationale: "Second attempt when Haiku's output fails validation.",
    decision_doc: null,
    decided_at: "2026-06-17",
    verified_at: VERIFIED,
  },
  {
    service: "homelab",
    slot: "bookmark-vision",
    label: "bookmark image tagging",
    model_id: "gemini-3.5-flash",
    category: null,
    thinking: "n/a",
    params: "INFERENCE_IMAGE_MODEL; image-asset bookmarks only",
    config_ref: "homelab/docker-compose.yml:620",
    rationale: "Same vision pick as sideclaw's read_image, for the same reasons.",
    decision_doc: "docs/decisions/vision-and-image.md",
    decided_at: "2026-06-17",
    verified_at: VERIFIED,
  },
];
