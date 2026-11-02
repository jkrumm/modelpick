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
    slot: "wave",
    // Runs on the Max plan, where the category's cost term is meaningless.
    follows_recommendation: false,
    literal_id: false,
    label: "rd wave — self-continuing pane chain",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "default",
    params:
      "RD_WAVE_MODEL, default sonnet on the claude kind; the opencode kind defaults to iu/deepseek-v4.1-flash",
    config_ref: "dotfiles/scripts/remote-dev.sh:601-606,703-708",
    rationale:
      "Runs on the Max plan through herdr panes, so the ccbench cost argument does not apply.",
    decision_doc: "docs/decisions/execution-modes.md",
    decided_at: "2026-08-02",
    verified_at: VERIFIED,
  },
  {
    service: "claude-code",
    slot: "analyze",
    // Runs on the Max plan, where the category's cost term is meaningless.
    follows_recommendation: false,
    literal_id: false,
    label: "/analyze — fallow static-analysis subagent",
    model_id: "claude-sonnet-5",
    category: "coding",
    thinking: "default",
    params: "native subagent on the pinned CLAUDE_CODE_SUBAGENT_MODEL",
    config_ref: "dotfiles/skills/analyze/SKILL.md:33",
    rationale:
      "Runs inside the Max session as one general-purpose subagent, so the report stays out of the main context at no metered cost.",
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

  // ── agent-workflows ────────────────────────────────────────────────────────────
  // The model_id of every row below is checked against the LIVE route table
  // (`agw routes --format json`) by scripts/verify-deployments.ts, not against source
  // text — a substring grep let rows pass for weeks after a move because the source
  // kept naming the old ids in comments.
  {
    service: "agent-workflows",
    slot: "check",
    follows_recommendation: false,
    label: "check — format · lint · tsc · test (CLASSIFY tier)",
    model_id: "claude-haiku-5-5",
    category: "coding",
    thinking: "high",
    params:
      "wire opencode (agent step, agw-check profile); effort high; fallback opencode gpt-6.1-terra low",
    config_ref: "agw-route:check",
    rationale:
      "Reading tool output and deciding pass/fail — the cheapest tier that holds an agent loop. 2026-10-15 (Wave 10 bench, 7bb7015): moved onto Haiku 5.5 on OpenCode; before, Haiku 4.5 over `claude -p` took 45-718 s per check run and gave one wrong verdict, at ~20x the cost. Still on that wire in the 2026-11-02 route table, now at effort high.",
    decision_doc: "docs/decisions/agent-gateway-tiers.md",
    decided_at: "2026-10-15",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "overview",
    follows_recommendation: false,
    label: "overview (CLASSIFY tier)",
    model_id: "claude-haiku-5-5",
    category: "coding",
    thinking: "high",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort high; fallback iu-openai gpt-6.1-terra low",
    config_ref: "agw-route:cheap.summarize",
    rationale:
      "Same CLASSIFY tier as check (Wave 10 bench, 2026-10-15). Before: Haiku 4.5 over `claude -p`, 170-180 s per overview. The route (cheap.summarize) has since moved to the anthropic wire at effort high.",
    decision_doc: "docs/decisions/agent-gateway-tiers.md",
    decided_at: "2026-10-15",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "triage",
    // SINGLE_SHOT, same tier and model as review_router below.
    follows_recommendation: false,
    label: "triage — work-item triage (SINGLE_SHOT tier)",
    model_id: "claude-haiku-5-5",
    category: "coding",
    thinking: "high",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort high; fallback iu-openai gpt-6.1-terra low (maxOutputTokens 32000); one tool-less JSON completion, no runSession",
    config_ref: "agw-route:triage",
    rationale:
      "2026-11-01 (Wave 3): the single-shot seat moved from deepseek-v4.1-flash onto Haiku 5.5 effort high on the anthropic wire, same tier as review_router and review_ocr. Before that, 2026-10-02 (5063a2a): a single-shot JSON completion instead of a claude -p session, 20-100x cheaper.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-01",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "review_router",
    // SINGLE_SHOT: one tool-less JSON completion, no session.
    follows_recommendation: false,
    label: "review_router (SINGLE_SHOT tier)",
    model_id: "claude-haiku-5-5",
    category: "coding",
    thinking: "high",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort high; fallback iu-openai gpt-6.1-terra low (maxOutputTokens 32000); one tool-less JSON completion, no runSession",
    config_ref: "agw-route:review.router",
    rationale:
      "Picks which review angles run — one short structured completion. 2026-11-01 (Wave 3): moved from deepseek-v4.1-flash onto Haiku 5.5 effort high on the anthropic wire, shared with triage and review_ocr.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-01",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "review",
    // Synthesis is the HARD tier since Wave 6.
    follows_recommendation: false,
    label: "review — multi-angle code review synthesis (JUDGE tier)",
    model_id: "claude-sonnet-5-5",
    category: "coding",
    thinking: "medium",
    params:
      "wire opencode (agent step); effort medium; fallback opencode gpt-6.1-terra medium. Angle reviewers are separate routes: review_angle_{senior_dev,typescript,frontend,qa} (review.angle, Haiku 5.5 high) and review.angle.deep (Sonnet 5.5 medium)",
    config_ref: "agw-route:review.synthesis",
    rationale:
      "Synthesis is the HARD tier: Sonnet 5.5 effort medium on OpenCode (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md). It was Haiku 5.5 from Wave 10 (2026-10-15), which saved wall time on two real ranges.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "review_angle_senior_dev",
    // Angle reviewer on the cheap OpenCode shape (review.angle) shared with the other angles.
    follows_recommendation: false,
    label: "review_angle_senior_dev — senior-dev review angle (ANGLE_OC tier)",
    model_id: "claude-haiku-5-5",
    category: "coding",
    thinking: "high",
    params: "wire opencode (agent step); effort high; fallback opencode gpt-6.1-terra low",
    config_ref: "agw-route:review.angle",
    rationale:
      "Cheap angle model, kept on Haiku 5.5 effort high by the owner hotfix of 2026-11-02 (cost; the angle cost is per review). Earlier evidence: 2026-10-05 Wave 4 A/B and 2026-10-14 Wave 5 moved the angles off deepseek-v4.1-flash onto Haiku 5.5 on OpenCode (12/12 vs 10/12 passes, ~6x faster). Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "review_angle_typescript",
    // Angle reviewer on the cheap OpenCode shape (review.angle) shared with the other angles.
    follows_recommendation: false,
    label: "review_angle_typescript — typescript review angle (ANGLE_OC tier)",
    model_id: "claude-haiku-5-5",
    category: "coding",
    thinking: "high",
    params: "wire opencode (agent step); effort high; fallback opencode gpt-6.1-terra low",
    config_ref: "agw-route:review.angle",
    rationale:
      "Cheap angle model, kept on Haiku 5.5 effort high by the owner hotfix of 2026-11-02 (cost; the angle cost is per review). Earlier evidence: 2026-10-05 Wave 4 A/B and 2026-10-14 Wave 5 moved the angles off deepseek-v4.1-flash onto Haiku 5.5 on OpenCode (12/12 vs 10/12 passes, ~6x faster). Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "review_angle_frontend",
    // Angle reviewer on the cheap OpenCode shape (review.angle) shared with the other angles.
    follows_recommendation: false,
    label: "review_angle_frontend — frontend review angle (ANGLE_OC tier)",
    model_id: "claude-haiku-5-5",
    category: "coding",
    thinking: "high",
    params: "wire opencode (agent step); effort high; fallback opencode gpt-6.1-terra low",
    config_ref: "agw-route:review.angle",
    rationale:
      "Cheap angle model, kept on Haiku 5.5 effort high by the owner hotfix of 2026-11-02 (cost; the angle cost is per review). Earlier evidence: 2026-10-05 Wave 4 A/B and 2026-10-14 Wave 5 moved the angles off deepseek-v4.1-flash onto Haiku 5.5 on OpenCode (12/12 vs 10/12 passes, ~6x faster). Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "review_angle_qa",
    // Angle reviewer on the cheap OpenCode shape (review.angle) shared with the other angles.
    follows_recommendation: false,
    label: "review_angle_qa — qa review angle (ANGLE_OC tier)",
    model_id: "claude-haiku-5-5",
    category: "coding",
    thinking: "high",
    params: "wire opencode (agent step); effort high; fallback opencode gpt-6.1-terra low",
    config_ref: "agw-route:review.angle",
    rationale:
      "Cheap angle model, kept on Haiku 5.5 effort high by the owner hotfix of 2026-11-02 (cost; the angle cost is per review). Earlier evidence: 2026-10-05 Wave 4 A/B and 2026-10-14 Wave 5 moved the angles off deepseek-v4.1-flash onto Haiku 5.5 on OpenCode (12/12 vs 10/12 passes, ~6x faster). Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "narrative",
    follows_recommendation: false,
    label: "narrative (CLASSIFY tier)",
    model_id: "claude-haiku-5-5",
    category: "writing",
    thinking: "off",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort none; fallback iu-openai gpt-6-luna low; tool-less. The rendered page is then polished in-process by the prose pipeline (prose_write/prose_review slots; polish:false skips)",
    config_ref: "agw-route:cheap.title",
    rationale:
      "Short-prose summary tier (cheap.title): Haiku 5.5, now effort none on the anthropic wire; Wave 10 (2026-10-15) had moved it from Sonnet on Max to Haiku on OpenCode. The writing stack pick is claude-opus-5-5 — this slot deliberately runs a cheaper model because the output is a summary, not authored prose.",
    decision_doc: "docs/decisions/agent-gateway-tiers.md",
    decided_at: "2026-10-15",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "prose_write",
    label: "prose writer (voice owner)",
    model_id: "claude-sonnet-5-5",
    category: "writing",
    thinking: "medium",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort medium; fallback iu-openai gpt-6.1-terra medium; adaptive thinking; maxOutputTokens 32000; voice.md as system prompt",
    config_ref: "agw-route:prose.write",
    rationale:
      "2026-11-01 (Wave 3): the rewrite seat moved from Opus 5.5 high to Sonnet 5.5 effort medium on the anthropic wire; the Opus-vs-Sonnet writing pick for authored prose (docs/decisions/writing-model.md) is separate. Gemini 4 Argon is ruled out by wire: the seat is anthropic-wire only.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-01",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "prose_review",
    label: "prose reviewer (cross-lab, notes only)",
    model_id: "deepseek-v4.1-flash",
    category: null,
    thinking: "default",
    params:
      "wire iu-openai (single-shot chat completions, json_object), no effort; maxOutputTokens 16000; fallback iu-openai gpt-6.1-terra medium; notes and rubric scores only, never rewrites",
    config_ref: "agw-route:prose.review",
    rationale:
      "Structural: the reviewer must come from a different lab than the writer (cross-model review beats same-model on documents, F1 30-42% vs 17-25%) and must be chat-wire, since the single-shot JSON path speaks chat completions only. Stays deepseek-v4.1-flash as the cross-lab reviewer in Wave 6 (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md).",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "adversary",
    label: "adversary — finding verification",
    model_id: "gpt-6.1-terra",
    category: null,
    thinking: "medium",
    params:
      "wire iu-openai (direct fetch, never runSession), effort medium; maxOutputTokens 16000; fallback iu-openai gpt-6-luna medium",
    config_ref: "agw-route:review.adversary",
    rationale:
      "Structural, not scored: the value is that it is a different family from the model that produced the finding. No category recommendation can express 'not the same vendor'. gpt-5.6-terra -> gpt-6.1-terra in the current route table.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "review_ocr",
    // Earlier bake-off 2026-09-25 picked deepseek-v4.1-flash; Wave 3 (2026-11-01) moved the seat onto Haiku 5.5.
    follows_recommendation: false,
    label: "review_ocr — alibaba/open-code-review input to review",
    model_id: "claude-haiku-5-5",
    category: null,
    thinking: "high",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort high; fallback iu-openai gpt-6.1-terra low (maxOutputTokens 32000)",
    config_ref: "agw-route:review.ocr",
    rationale:
      "2026-11-01 (Wave 3): the review.ocr seat moved from deepseek-v4.1-flash onto Haiku 5.5 effort high on the anthropic wire. The earlier 2026-09-25 bake-off (ocr's tool loop, --effort low) measured deepseek-v4.1-flash; that measurement no longer describes the live route.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-01",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "otel",
    // HARD tier on OpenCode since Wave 6.
    follows_recommendation: false,
    label: "otel — observability queries (HARD tier)",
    model_id: "claude-sonnet-5-5",
    category: "coding",
    thinking: "medium",
    params:
      "wire opencode (agent step); effort medium; fallback opencode gpt-6.1-terra medium; runs inline, never queued — the one tool exempt from the job contract",
    config_ref: "agw-route:otel.agent",
    rationale:
      "Interactive debugging: a jobId round-trip would cost more than the query. Wave 6 moved it from Sonnet on Max to Sonnet 5.5 effort medium on OpenCode, the HARD tier (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md).",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "agent-workflows",
    slot: "excalidraw",
    label: "excalidraw_diagram (FAST tier)",
    model_id: "claude-haiku-5-5",
    category: null,
    thinking: "off",
    params: "wire opencode (agent step); effort none; fallback opencode gpt-6.1-terra low",
    config_ref: "agw-route:diagram.agent",
    rationale:
      "Structural: generating valid Excalidraw JSON is a format-fidelity job no category scores. Wave 6 put diagram.agent on the FAST tier, Haiku 5.5 effort none (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md).",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },

  // ── hermes ────────────────────────────────────────────────────────────────
  {
    service: "hermes",
    slot: "brain",
    // The `fast` recommender scores on leaderboards; this pick rests on bench-fast plus a live
    // trial — an explicit owner override, not unnoticed drift.
    follows_recommendation: false,
    label: "brain — the agent loop",
    model_id: "deepseek-v4.1-flash",
    category: "fast",
    thinking: "high",
    params:
      "OpenAI-compat leg: provider custom, api_mode chat_completions in BOTH model (:9) and providers.custom (:21); base_url/api_key ${OPENAI_BASE_URL}/${OPENAI_API_KEY}; agent.reasoning_effort high (:75) goes out as reasoning_effort with tools on the same request (patches/transport-iu-reasoning-effort.patch leaves DeepSeek's effort untouched; tests/test_iu_reasoning_effort.py asserts it), max_completion_tokens 65536; context_length 1000000. The id is DeepSeek first-party via Requesty — the 1017 snapshot (same system_fingerprint as the explicit -1017 id, 2026-10-19). Flat $0.30/$1.20, no 100k cliff",
    config_ref: "hermes-agent/config.yaml:6,9,21,75",
    rationale:
      "2026-10-20 (trial, owner call): back from Haiku 5.5 EU to deepseek-v4.1-flash now that the id serves 1017 on DeepSeek's own route — AA 45.1 vs Haiku high 37.8, effort honoured (bench-fast 15/15 at every effort, high 1.4 s median), no 5x price step between 100k and the 240k compaction trigger. Live-verified 2026-10-20 over the gateway API: effort high on the wire, 104 reasoning tokens on a multi-step question (correct), 99% cache read from call 2, 1.2-2.3 s per call, usage-tracker prices the rows (computed, off-peak aware). Revert: the anthropic_messages block from hermes-agent bfa33c3. Haiku 5.5 EU stays the approval lane.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-10-20",
    verified_at: "2026-10-20",
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
    // Same override as brain — the recommender scores `fast` on leaderboards and does not name this pick.
    follows_recommendation: false,
    label: "context compression",
    model_id: "gpt-6-luna",
    category: "fast",
    thinking: "high",
    params:
      "provider custom, api_mode chat_completions, reasoning_effort high, context_length 850000 (load-bearing: the aux model's own context_length clamps the 240k compaction trigger), timeout 1800 (a hang guard, not a budget — a high-effort summary of a long thread can legitimately think past 120s). NO max_tokens by design — context_compressor.py:646 forbids a wire cap, a truncated summary poisons the whole downstream session.",
    config_ref: "hermes-agent/config.yaml:182-193",
    rationale:
      "2026-10-09 (hermes-agent 241f9d2, 'compression on gpt-6-luna, DeepSeek no longer routed'): moved off deepseek-v4.1-flash onto gpt-6-luna, the same model as the brain failover and title generation, so DeepSeek is no longer routed from hermes at all. Compression sends no tools, so luna's tools+effort 503 does not apply.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-10-09",
    verified_at: VERIFIED,
  },
  {
    service: "hermes",
    slot: "approval-classifier",
    // Residency-gated — the category winner is not region-verified.
    follows_recommendation: false,
    label: "approval classifier",
    model_id: "claude-haiku-5-5",
    category: "fast",
    thinking: "medium",
    params:
      "api_mode anthropic_messages; context 1000000; temperature=0 hardcoded in approval_smart.py, stripped by the adapter for 5.x; max_tokens 16 with default adaptive thinking (API default medium) — did not starve in the live probe. Idle while approvals.mode is off.",
    config_ref: "hermes-agent/config.yaml:205-224",
    rationale:
      "2026-10-08: off claude-haiku-4-5, which APPROVED `rm -rf ~/SourceRoot` in a probe; 5.5 EU escalates it through the real _smart_approve path (0.7–4.3s) and still approves harmless commands.",
    decision_doc: "docs/decisions/hermes-brain.md",
    decided_at: "2026-10-08",
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
    model_id: "claude-sonnet-5-5",
    category: null,
    thinking: "n/a",
    params: "provider custom, IU OpenAI leg (api_mode chat_completions); timeout 120",
    config_ref: "hermes-agent/config.yaml:196-203",
    rationale:
      "Manual category. Moved off the direct-Google gemini-2.5-flash aux client onto the IU OpenAI leg on gemini-3.5-flash, matching agent-gateway's read_image pick — closes the undeliberate split this row used to flag.",
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
    model_id: "claude-haiku-5-5-eu",
    category: "fast",
    thinking: "default",
    params:
      "delegation toolset is DISABLED (agent.disabled_toolsets) — dormant; model '' and reasoning_effort '' — both inherit the brain; child_timeout_seconds 0; max_iterations unlimited (sys.maxsize); max_concurrent_children 10; max_spawn_depth 1",
    config_ref: "hermes-agent/config.yaml:399-417",
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
    follows_recommendation: true,
    label: "voice replies",
    model_id: "gemini-3.8-flash-lite-tts",
    category: "tts",
    thinking: "n/a",
    params:
      "voice Charon; via audio-gateway.jkrumm.com/v1; speed 1. Streaming clients (CLI voice, desktop speak-stream) send response_format pcm and read the stream; Slack/file replies stay whole-file mp3 with X-Audio-Title. ElevenLabs flash-v2.5 / Mark stays a model-id fallback.",
    config_ref: "hermes-agent/config.yaml:343-349",
    rationale:
      "Prep off on the lite lane, so first PCM is 0.6-1.5 s per sentence (W3 end-to-end, 2026-10-25) at ~$0.009/min; AA #8 against flash-v2.5 unranked. US-routed, accepted for generated reply text.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-10-25",
    verified_at: VERIFIED,
  },
  {
    service: "hermes",
    slot: "stt",
    label: "voice input transcription",
    model_id: "gpt-transcribe",
    category: "stt",
    thinking: "n/a",
    params: "via audio-gateway",
    config_ref: "hermes-agent/config.yaml:357-360",
    rationale:
      "Most accurate IU STT (gpt-transcribe since 2026-10-15, replacing the deprecated gpt-4o-transcribe). Residency requirement is eu because this slot carries recorded voice, which audio-stack.md does not accept on a US route — the route's actual region is unverified, so this row is a live tension, not a settled pick.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-10-15",
    verified_at: VERIFIED,
  },

  // ── research-gateway ──────────────────────────────────────────────────────
  {
    service: "research",
    slot: "lead",
    // One route (research.agent) serves lead and worker.
    follows_recommendation: false,
    label: "lead — plan + synthesis",
    model_id: "claude-sonnet-5-5",
    category: "fast",
    thinking: "medium",
    params:
      "wire opencode (agent step, research.agent); effort medium; fallback opencode gpt-6.1-terra medium. Lead and worker share one route.",
    config_ref: "agw-route:research.agent",
    rationale:
      "Wave 6 (2026-11-02): research.agent moved from deepseek-v4.1-flash onto Sonnet 5.5 effort medium, the HARD tier (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md). Lead and worker are one role-agnostic route, so they cannot diverge.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "research",
    slot: "worker",
    // Same route as lead — one role, one model.
    follows_recommendation: false,
    label: "worker — page fetch + extraction",
    model_id: "claude-sonnet-5-5",
    category: "fast",
    thinking: "medium",
    params:
      "wire opencode (agent step, research.agent); effort medium; WORKER_MAX_CONCURRENCY=8; shares the lead's route",
    config_ref: "agw-route:research.agent",
    rationale:
      "Wave 6 (2026-11-02): same route as lead, Sonnet 5.5 effort medium (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md). Eight concurrent workers still make per-call cost and TTFT the binding constraints.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },

  // ── audio-gateway ─────────────────────────────────────────────────────────
  {
    service: "audio",
    slot: "tts-default",
    // A deliberately different tier from the category winner.
    follows_recommendation: false,
    label: "/audio/speech default",
    model_id: "gemini-3.8-flash-lite-tts",
    category: "tts",
    thinking: "n/a",
    params: "gateway owns the choice; a caller's model id is remapped (model-resolution.ts:56-62). Prep off; briefings name gemini-3.8-flash-tts (TTS_GEMINI_PREP_MODELS) for prep on.",
    config_ref: "agw-route:audio.tts.gemini-flash-lite",
    rationale:
      "The gateway default for callers that name nothing; the same model as the tts stack pick and Hermes' chat lane.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-10-25",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "stt-default",
    label: "/audio/transcriptions default",
    model_id: "voxtral-mini-transcribe-3-0",
    category: "stt",
    thinking: "n/a",
    params: "allowlist (STT_MODELS): whisper, voxtral-{mini,small}-transcribe-3-0, gpt-transcribe, gpt-4o-transcribe, gpt-4o-mini-transcribe; anything else remapped; outage fallback chain gpt-transcribe, then whisper",
    config_ref: "agw-route:audio.stt.voxtral-mini",
    rationale: "Voxtral mini (Mistral, EU-resident) is the default since 2026-10-25; Whisper stays allowlisted only for timestamps/verbose_json, which the gpt-* ids reject.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-10-25",
    verified_at: VERIFIED,
  },
  {
    service: "audio",
    slot: "tts-prep",
    label: "TTS text-prep LLM",
    model_id: "claude-haiku-5-5",
    category: "fast",
    thinking: "off",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort none; fallback iu-openai gpt-6-luna low (maxOutputTokens 32000); prep runs only for allowlisted models (elevenlabs/v3)",
    config_ref: "agw-route:audio.tts.prep",
    rationale:
      "The prep pass is why Gemini TTS measured ~10s per reply end to end — it is counted against the TTS latency, not hidden behind it. 2026-11-01 (Wave 3): moved from gpt-6-luna onto Haiku 5.5 effort none on the anthropic wire; gpt-6-luna is now the fallback.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-01",
    verified_at: "2026-11-02",
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
    config_ref: "agw-route:audio.tts.summary",
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
    model_id: "claude-sonnet-5-5",
    category: "writing",
    thinking: "medium",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort medium; fallback iu-openai gpt-6.1-terra medium; 32k max_tokens floor; brain/voice.md ahead of the show bible",
    config_ref: "agw-route:podcast.write",
    rationale:
      "Wave 6 (2026-11-02): moved from Opus 5.5 high to Sonnet 5.5 effort medium on the anthropic wire (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md). The writing stack pick for authored prose (docs/decisions/writing-model.md) is separate.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "audio",
    slot: "podcast-outline",
    follows_recommendation: false,
    label: "podcast outline",
    model_id: "claude-sonnet-5-5",
    category: "fast",
    thinking: "medium",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort medium; fallback iu-openai gpt-6.1-terra medium",
    config_ref: "agw-route:podcast.outline",
    rationale:
      "Structure, not prose. Wave 6 (2026-11-02): moved from deepseek-v4.1-flash onto Sonnet 5.5 effort medium (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md).",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "audio",
    slot: "podcast-review",
    label: "podcast review panel",
    model_id: "gemini-3.8-flash,gpt-6.1-terra",
    category: null,
    thinking: "default",
    params:
      "podcast.review.a gemini-3.8-flash (iu-openai, no effort; fallback gpt-6.1-terra medium); podcast.review.b gpt-6.1-terra (iu-openai, effort medium; fallback gpt-6-luna medium); every role runs on both",
    config_ref: "agw-route:podcast.review.a,podcast.review.b",
    rationale:
      "Structural: a panel is valuable because its members disagree, so 'the best model' is the wrong question and no category scores it. Wave 6 (2026-11-02): reviewer b moved from deepseek-v4.1-flash to gpt-6.1-terra medium, the cross-lab reviewer (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md); reviewer a stays gemini-3.8-flash.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "audio",
    slot: "podcast-editorial",
    follows_recommendation: false,
    label: "podcast editorial pass",
    model_id: "claude-sonnet-5-5",
    category: "fast",
    thinking: "medium",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort medium; fallback iu-openai gpt-6.1-terra medium",
    config_ref: "agw-route:podcast.editorial",
    rationale:
      "Editorial pass. Wave 6 (2026-11-02): moved from deepseek-v4.1-flash onto Sonnet 5.5 effort medium (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md); the authored-prose pass is podcast-write.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "audio",
    slot: "podcast-research",
    follows_recommendation: false,
    label: "podcast research pass",
    model_id: "claude-sonnet-5-5",
    category: "fast",
    thinking: "medium",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort medium; fallback iu-openai gpt-6.1-terra medium; output budget 32000",
    config_ref: "agw-route:podcast.research",
    rationale:
      "Tool-calling researcher (brain search/read, past episodes, research gateway). Wave 6 (2026-11-02): moved from deepseek-v4.1-flash onto Sonnet 5.5 effort medium (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md).",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "audio",
    slot: "podcast-metadata",
    follows_recommendation: false,
    label: "podcast metadata",
    model_id: "claude-haiku-5-5",
    category: "fast",
    thinking: "high",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort high; fallback iu-openai gpt-6.1-terra low",
    config_ref: "agw-route:podcast.metadata",
    rationale:
      "Chapters, titles, descriptions — a structured-output job. Wave 6 (2026-11-02): moved from deepseek-v4.1-flash onto Haiku 5.5 effort high (Wave 6 eval, agent-workflows docs/evals/2026-11-02-claude-seats.md).",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-02",
    verified_at: "2026-11-02",
  },
  {
    service: "audio",
    slot: "podcast-tts",
    // A deliberately different tier from the category winner.
    follows_recommendation: false,
    label: "podcast narration",
    model_id: "gemini-3.8-flash-tts",
    category: "tts",
    thinking: "n/a",
    params: "two-speaker runs (<= 3000 chars) per request, voices Charon + Erinome, per-host style string, inline <short pause>/<laugh>/<sigh> tags; elevenlabs/v3 per turn stays selectable by model id",
    config_ref: "agw-route:audio.tts.gemini-flash",
    rationale:
      "Owner decision 2026-10-25: one multi-speaker call keeps both voices coherent, 1/7 of v3's cost. The stack pick is the lite chat model; this lane needs the full flash model for expression.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-10-25",
    verified_at: VERIFIED,
  },

  // ── argo · image-gateway · rb · homelab ───────────────────────────────────────
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
    service: "image-gateway",
    slot: "enhance",
    label: "/enhance prompt-plan brain",
    model_id: "claude-haiku-5-5",
    category: "fast",
    thinking: "high",
    params:
      "wire anthropic (native Messages on the local inference gateway, paid from Claude credit), effort high; fallback iu-openai gpt-6-luna high; maxOutputTokens 32000; JSON plan, no tools",
    config_ref: "agw-route:image.enhance",
    rationale:
      "Expanding a brief into a JSON plan is short single-shot work. 2026-11-01 (Wave 3): the planner moved from gpt-6-luna (2026-10-08, bench-fast 15/15 at every effort) onto Haiku 5.5 effort high on the anthropic wire; gpt-6-luna high is the fallback.",
    decision_doc: "docs/decisions/agw-text-seats.md",
    decided_at: "2026-11-01",
    verified_at: "2026-11-02",
  },
  {
    service: "image-gateway",
    slot: "generate",
    label: "image generation family",
    model_id: "gpt-image-2.5-flare",
    category: null,
    thinking: "n/a",
    params:
      "DEFAULT_MODEL; its sibling gpt-image-2.5-sunburst serves the finals — model auto routes in shared/src/rules.ts: edits and high/xhigh/max generates -> sunburst, low/medium/auto -> flare; legacy gpt-image-2 requests routed like auto",
    config_ref: "agw-route:image.flare",
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
    rationale: "Same vision pick as agent-gateway's read_image, for the same reasons.",
    decision_doc: "docs/decisions/vision-and-image.md",
    decided_at: "2026-06-17",
    verified_at: VERIFIED,
  },
  // ── email-gateway (VPS container; one LLM_MODEL env feeds four lanes) ──────
  {
    service: "email-gateway",
    slot: "decision-lane",
    label: "shadow decision lane (Jev, historical name)",
    model_id: "pplx-decider-v1-27b",
    category: "decision",
    thinking: "n/a",
    params:
      "DECISION_PROVIDER=ue; UE systemone wire via @ai-sdk/typesafe-ai (createTypeSafeAi({ baseURL: <origin of LLM_BASE_URL>/decisions/v1 }).decisionModel, experimental_decide; DECISION_BASE_URL overrides), no sampling params. The provider drops usage.cost, so argo cost is computed from DECISION_RATES. Shadow mode: recorded beside the LLM classifier's verdict, never authoritative. DECISION_MODEL defaults to pplx-decider-v1-27b in src/env.ts too.",
    config_ref: "vps/apps/email-gateway/compose.yml:43",
    rationale:
      "2026-10-13: residency and cost are not criteria (owner). The only model at 100% on all four bench suites incl. adversarial hard-verdict and urgency, Brier 0.0011 (10x the next), hedges on borderline cases and honours the 'when unsure, choose legit' rule jev-latest breaks. Earlier: Vercel Jev (403) -> OpenRouter Clef -> UE clef-eu (2026-10-09) -> decision-1-eu (2026-10-13, residency + cost) -> PPLX the same day.",
    decision_doc: "docs/decisions/decision-model.md",
    decided_at: "2026-10-13",
    verified_at: "2026-10-13",
  },
  {
    service: "email-gateway",
    slot: "spam-classifier",
    // One LLM_MODEL env feeds all four lanes; Luna is the estate's
    // latency-critical small-call tier, not the algorithm's fast pick.
    follows_recommendation: false,
    label: "contact-form spam classifier (8 s deadline)",
    model_id: "gpt-6-luna",
    category: "fast",
    thinking: "default",
    params:
      "LLM_MODEL via the AI SDK openai-compatible provider, structured output; src/spam/classify.ts",
    config_ref: "vps/apps/email-gateway/compose.yml:29",
    rationale:
      "Sits on the submission path of three live callers (7 s / 10 s / 30 s aborts) behind an 8 s gate deadline, so latency decides it. One env var, LLM_MODEL, serves this lane and the three below.",
    decision_doc: "docs/decisions/fast-model.md",
    decided_at: "2026-10-09",
    verified_at: "2026-10-09",
  },
  {
    service: "email-gateway",
    slot: "enrichment",
    follows_recommendation: false,
    label: "inbound email enrichment",
    model_id: "gpt-6-luna",
    category: "fast",
    thinking: "default",
    params: "LLM_MODEL; src/enrich/enrich-email.ts, 30-min hang guard, no budget",
    config_ref: "vps/apps/email-gateway/compose.yml:29",
    rationale: "Same LLM_MODEL env as the classifier — one id, four lanes.",
    decision_doc: "docs/decisions/fast-model.md",
    decided_at: "2026-10-09",
    verified_at: "2026-10-09",
  },
  {
    service: "email-gateway",
    slot: "thread-summary",
    follows_recommendation: false,
    label: "agent-API thread summary",
    model_id: "gpt-6-luna",
    category: "fast",
    thinking: "default",
    params: "LLM_MODEL; src/llm/thread-summary.ts, cached in thread_summaries",
    config_ref: "vps/apps/email-gateway/compose.yml:29",
    rationale: "Same LLM_MODEL env as the classifier — one id, four lanes.",
    decision_doc: "docs/decisions/fast-model.md",
    decided_at: "2026-10-09",
    verified_at: "2026-10-09",
  },
  {
    service: "email-gateway",
    slot: "draft-reply",
    // Prose for the owner to edit, but on the shared LLM_MODEL env: the writing
    // pick (claude-opus-4-6) is not reachable through this service's UE key setup.
    follows_recommendation: false,
    label: "agent-API draft reply",
    model_id: "gpt-6-luna",
    category: "writing",
    thinking: "default",
    params: "LLM_MODEL; src/llm/draft-reply.ts — drafts only, never sends",
    config_ref: "vps/apps/email-gateway/compose.yml:29",
    rationale:
      "Grouped under writing for what it produces, but wired to the shared LLM_MODEL env, so it follows the other three lanes by construction. Splitting it onto a writing model needs its own env var in email-gateway first.",
    decision_doc: null,
    decided_at: "2026-10-09",
    verified_at: "2026-10-09",
  },
];
