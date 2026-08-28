// Thin, purpose-built client for scripts/pick.ts against the IU unified
// endpoint's native Anthropic-protocol route (IU_ANTHROPIC_BASE_URL). Unlike
// gatewayChat() in ../iu/client.ts — which sends the minimum needed for an
// access probe — this one exposes the full request/response shape the pick
// probes need: a `system` array with `cache_control`, `usage.cost` (the
// Requesty-proxied non-Claude models carry it; real Claude never does),
// `cache_read_input_tokens`, `stop_reason`, and `thinking` content blocks.
import { rawFetch } from "../iu/client.js";

const ANTHROPIC_VERSION = "2023-06-01";

function anthropicBase(): string {
  return process.env["IU_ANTHROPIC_BASE_URL"] ?? "";
}

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  system?: AnthropicSystemBlock[];
  messages: Array<{ role: "user"; content: string }>;
}

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  /** Only present for non-Claude models on this route — they're proxied via
   *  Requesty. Real Claude models (AWS Bedrock / Azure) never carry this. */
  cost?: number;
}

export interface AnthropicMessageResult {
  ok: boolean;
  status: number | "timeout";
  stopReason: string | null;
  usage: AnthropicUsage | null;
  hasThinking: boolean;
  /** Raw error body (or the parsed error message when JSON) on failure. */
  errorText: string | null;
}

interface AnthropicMessageBody {
  content?: Array<{ type: string }>;
  stop_reason?: string;
  usage?: AnthropicUsage;
  error?: { message?: string };
  message?: string;
}

/** Sends one `/messages` call against the Anthropic-protocol route. */
export async function anthropicMessage(
  req: AnthropicMessageRequest,
  opts: { timeoutMs?: number } = {},
): Promise<AnthropicMessageResult> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 60_000);
  const r = await rawFetch(`${anthropicBase()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify(req),
    signal,
  });

  if (r.status === "timeout") {
    return {
      ok: false,
      status: r.status,
      stopReason: null,
      usage: null,
      hasThinking: false,
      errorText: r.body,
    };
  }

  let body: AnthropicMessageBody;
  try {
    body = JSON.parse(r.body) as AnthropicMessageBody;
  } catch {
    return {
      ok: false,
      status: r.status,
      stopReason: null,
      usage: null,
      hasThinking: false,
      errorText: r.status >= 200 && r.status < 300 ? "unparseable success body" : r.body,
    };
  }

  if (r.status < 200 || r.status >= 300) {
    return {
      ok: false,
      status: r.status,
      stopReason: null,
      usage: null,
      hasThinking: false,
      errorText: body.error?.message ?? body.message ?? r.body,
    };
  }

  const hasThinking = (body.content ?? []).some(
    (b) => b.type === "thinking" || b.type === "redacted_thinking",
  );
  return {
    ok: true,
    status: r.status,
    stopReason: body.stop_reason ?? null,
    usage: body.usage ?? null,
    hasThinking,
    errorText: null,
  };
}

function extractModelIds(raw: unknown): string[] {
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : raw !== null &&
        typeof raw === "object" &&
        Array.isArray((raw as Record<string, unknown>)["data"])
      ? ((raw as Record<string, unknown>)["data"] as unknown[])
      : [];
  return arr
    .map((m) => (m !== null && typeof m === "object" ? (m as Record<string, unknown>)["id"] : null))
    .filter((id): id is string => typeof id === "string");
}

/** Lists what the Anthropic-protocol route currently serves (GET /models — a
 *  free listing call, unlike every other function in this module). */
export async function listAnthropicModels(): Promise<string[]> {
  const r = await rawFetch(`${anthropicBase()}/models`, { method: "GET" });
  if (r.status === "timeout" || r.status < 200 || r.status >= 300) {
    throw new Error(
      `GET ${anthropicBase()}/models failed: HTTP ${r.status} — ${r.body.slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(r.body) as unknown;
  return extractModelIds(parsed);
}

/** Non-Claude ids are what this route proxies through Requesty and carry
 *  `usage.cost`; Claude ids route to AWS Bedrock eu-west-1 / Azure Sweden. */
export function isClaudeModel(id: string): boolean {
  return /^claude/i.test(id);
}
