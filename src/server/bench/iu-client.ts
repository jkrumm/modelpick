/**
 * The streaming IU HTTP client shared by the single-call benches (bench-fast,
 * bench-writing). Two wires: the OpenAI-compat chat-completions leg and the
 * native Anthropic Messages leg. Everything a bench needs to read off one call
 * — timings, token usage split into visible and reasoning, the finish reason —
 * comes back in one `CallOutcome`.
 *
 * Moved verbatim in intent out of scripts/bench-fast.ts so a second bench never
 * grows a second client; the bench-specific parts (prompts, grading, cost) stay
 * with the callers. Needs `IU_API_KEY` plus `IU_OPENAI_BASE_URL` /
 * `IU_ANTHROPIC_BASE_URL` in the environment (secrets-run supplies them).
 */
import { inferUsage, type EffortLevel } from "./fast-metrics.js";

export type Wire = "openai" | "anthropic";

export type CallOutcome =
  | {
      kind: "ok";
      ttfbMs: number | null;
      ttftMs: number | null;
      wallMs: number;
      visibleTokens: number;
      reasoningTokens: number;
      reportedReasoningTokens: number;
      promptTokens: number;
      finishReason: string | null;
      hasUsage: boolean;
      text: string;
    }
  | { kind: "unsupported"; message: string }
  | { kind: "error"; message: string; wallMs: number };

export interface CallInput {
  model: string;
  effort: EffortLevel;
  prompt: string;
  /** Sent as a system message (OpenAI wire) or the top-level `system` field
   *  (Anthropic wire). */
  system?: string;
  maxTokens: number;
  timeoutMs: number;
  wire: Wire;
}

/** `default` sends no reasoning parameter at all; every other level is sent
 *  literally as `reasoning_effort`. */
function reasoningExtra(effort: EffortLevel): Record<string, unknown> | undefined {
  return effort === "default" ? undefined : { reasoning_effort: effort };
}

/** Effort maps onto the Messages API: `default` sends nothing (Haiku 5.5 then
 *  runs adaptive at `medium`), `none` disables thinking, the rest go in
 *  `output_config.effort`. */
function anthropicEffortExtra(effort: EffortLevel): Record<string, unknown> | undefined {
  if (effort === "default") return undefined;
  if (effort === "none") return { thinking: { type: "disabled" } };
  return { thinking: { type: "adaptive" }, output_config: { effort } };
}

// ── SSE parsing (verbatim in intent from benchmark-bakeoff.ts's readSse) ─────

async function readSse(resp: Response, onEvent: (parsed: unknown) => void): Promise<void> {
  if (!resp.body) throw new Error("no response body");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "" || data === "[DONE]") continue;
      try {
        onEvent(JSON.parse(data));
      } catch {
        // partial SSE frame — ignore
      }
    }
  }
}

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

// ── OpenAI-compat wire ───────────────────────────────────────────────────────

async function runOpenAiCall(input: CallInput): Promise<CallOutcome> {
  const { model, effort, prompt, system, maxTokens, timeoutMs } = input;
  const start = performance.now();
  let resp: Response;
  try {
    resp = await fetch(`${env("IU_OPENAI_BASE_URL")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env("IU_API_KEY")}`,
      },
      body: JSON.stringify({
        model,
        messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
        max_completion_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        ...reasoningExtra(effort),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      kind: "error",
      message: isTimeout(err) ? "timeout" : err instanceof Error ? err.message : String(err),
      wallMs: isTimeout(err) ? timeoutMs : performance.now() - start,
    };
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "");
    // A non-2xx that names the parameter in its body, or one that is not even
    // JSON (glm-5.3-flash rejecting `medium`, observed live 2026-09-12), is
    // the real "the route rejects this effort level" signal — anything else
    // is a generic failure.
    const unsupported = effort !== "default" && (/reasoning_effort/i.test(bodyText) || !parsesAsJson(bodyText));
    if (unsupported) {
      return { kind: "unsupported", message: bodyText.slice(0, 200) || `HTTP ${resp.status}, non-JSON body` };
    }
    return {
      kind: "error",
      message: `HTTP ${resp.status}: ${bodyText.slice(0, 200)}`,
      wallMs: performance.now() - start,
    };
  }

  let firstFrameAt: number | null = null;
  let firstTokenAt: number | null = null;
  let text = "";
  let promptTokens = 0;
  let visibleTokens = 0;
  let reasoningTokens = 0;
  let reportedReasoningTokens = 0;
  let finishReason: string | null = null;
  let hasUsage = false;

  try {
    await readSse(resp, (event) => {
      const parsed = event as {
        choices?: Array<{
          delta?: { content?: string; reasoning_content?: string; reasoning?: string };
          finish_reason?: string | null;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      // Any parsed frame counts toward ttfb, including a reasoning-only delta —
      // the point is separating transport latency from thinking time, not just
      // measuring time to visible text.
      firstFrameAt ??= performance.now();
      const fr = parsed.choices?.[0]?.finish_reason;
      if (fr) finishReason = fr;
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) {
        firstTokenAt ??= performance.now();
        text += delta;
      }
      if (parsed.usage) {
        const promptTok = parsed.usage.prompt_tokens ?? 0;
        const completionTok = parsed.usage.completion_tokens ?? 0;
        const totalTok = parsed.usage.total_tokens ?? 0;
        const reported = parsed.usage.completion_tokens_details?.reasoning_tokens ?? 0;
        promptTokens = promptTok;
        // inferUsage carries the same shape-agnostic double-billing fix
        // benchmark-bakeoff.ts documents, plus the fallback that shape alone
        // misses: a route reporting `reasoning_tokens: 0` while still visibly
        // thinking — see src/server/bench/fast-metrics.ts for the derivation.
        const inferred = inferUsage({
          promptTokens: promptTok,
          completionTokens: completionTok,
          totalTokens: totalTok,
          reportedReasoningTokens: reported,
          streamedText: text,
        });
        visibleTokens = inferred.visibleTokens;
        reasoningTokens = inferred.reasoningTokens;
        reportedReasoningTokens = inferred.reportedReasoningTokens;
        hasUsage = true;
      }
    });
  } catch (err) {
    return {
      kind: "error",
      message: isTimeout(err) ? "timeout mid-stream" : err instanceof Error ? err.message : String(err),
      wallMs: isTimeout(err) ? timeoutMs : performance.now() - start,
    };
  }

  const end = performance.now();
  return {
    kind: "ok",
    ttfbMs: firstFrameAt === null ? null : firstFrameAt - start,
    ttftMs: firstTokenAt === null ? null : firstTokenAt - start,
    wallMs: end - start,
    visibleTokens: visibleTokens > 0 ? visibleTokens : Math.round(text.length / 4),
    reasoningTokens,
    reportedReasoningTokens,
    promptTokens,
    finishReason,
    hasUsage,
    text,
  };
}

// ── Anthropic Messages wire ──────────────────────────────────────────────────

async function runAnthropicCall(input: CallInput): Promise<CallOutcome> {
  const { model, effort, prompt, system, maxTokens, timeoutMs } = input;
  const start = performance.now();
  let resp: Response;
  try {
    resp = await fetch(`${env("IU_ANTHROPIC_BASE_URL")}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env("IU_API_KEY"),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        stream: true,
        ...anthropicEffortExtra(effort),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      kind: "error",
      message: isTimeout(err) ? "timeout" : err instanceof Error ? err.message : String(err),
      wallMs: isTimeout(err) ? timeoutMs : performance.now() - start,
    };
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "");
    const unsupported = effort !== "default" && /thinking|effort/i.test(bodyText);
    if (unsupported) return { kind: "unsupported", message: bodyText.slice(0, 200) };
    return { kind: "error", message: `HTTP ${resp.status}: ${bodyText.slice(0, 200)}`, wallMs: performance.now() - start };
  }

  let firstFrameAt: number | null = null;
  let firstTokenAt: number | null = null;
  let text = "";
  let promptTokens = 0;
  let outputTokens = 0;
  let reportedReasoningTokens = 0;
  let stopReason: string | null = null;
  let hasUsage = false;

  try {
    await readSse(resp, (event) => {
      const parsed = event as {
        type?: string;
        message?: { usage?: { input_tokens?: number } };
        delta?: { type?: string; text?: string; stop_reason?: string | null };
        usage?: { output_tokens?: number; output_tokens_details?: { thinking_tokens?: number } };
      };
      firstFrameAt ??= performance.now();
      if (parsed.type === "message_start") promptTokens = parsed.message?.usage?.input_tokens ?? 0;
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && parsed.delta.text) {
        firstTokenAt ??= performance.now();
        text += parsed.delta.text;
      }
      if (parsed.type === "message_delta") {
        stopReason = parsed.delta?.stop_reason ?? stopReason;
        if (parsed.usage) {
          outputTokens = parsed.usage.output_tokens ?? outputTokens;
          reportedReasoningTokens = parsed.usage.output_tokens_details?.thinking_tokens ?? reportedReasoningTokens;
          hasUsage = true;
        }
      }
    });
  } catch (err) {
    return {
      kind: "error",
      message: isTimeout(err) ? "timeout mid-stream" : err instanceof Error ? err.message : String(err),
      wallMs: isTimeout(err) ? timeoutMs : performance.now() - start,
    };
  }

  // Anthropic bills thinking inside output_tokens; the same inference the
  // OpenAI path uses splits it back out when the route omits thinking_tokens.
  const inferred = inferUsage({
    promptTokens,
    completionTokens: outputTokens,
    totalTokens: promptTokens + outputTokens,
    reportedReasoningTokens,
    streamedText: text,
  });
  return {
    kind: "ok",
    ttfbMs: firstFrameAt === null ? null : firstFrameAt - start,
    ttftMs: firstTokenAt === null ? null : firstTokenAt - start,
    wallMs: performance.now() - start,
    visibleTokens: inferred.visibleTokens > 0 ? inferred.visibleTokens : Math.round(text.length / 4),
    reasoningTokens: inferred.reasoningTokens,
    reportedReasoningTokens: inferred.reportedReasoningTokens,
    promptTokens,
    // classifyOutcome speaks the OpenAI vocabulary.
    finishReason: stopReason === "max_tokens" ? "length" : stopReason,
    hasUsage,
    text,
  };
}

export function callIu(input: CallInput): Promise<CallOutcome> {
  return input.wire === "anthropic" ? runAnthropicCall(input) : runOpenAiCall(input);
}

/** Claude models run on the IU **Anthropic** leg — the native wire Claude Code
 *  and the agent-gateway `claude` harness actually call. Every other id
 *  (gemini-*, gpt-*, deepseek-*, …) is reached on the OpenAI-compat leg.
 *  `openaiWire` forces the OpenAI leg for Claude ids too. */
export function wireFor(model: string, options: { openaiWire: boolean }): Wire {
  return model.startsWith("claude-") && !options.openaiWire ? "anthropic" : "openai";
}
