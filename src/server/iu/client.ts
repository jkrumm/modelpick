import type { Residency } from "../../db/schema.js";

export class IuFetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "IuFetchError";
  }
}

export interface IuResponse<T = unknown> {
  body: T;
  headers: Headers;
  status: number;
}

const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseBody<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.arrayBuffer()) as unknown as T;
}

export async function iuFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<IuResponse<T>> {
  const base = process.env["IU_OPENAI_BASE_URL"] ?? "";
  const key = process.env["IU_API_KEY"] ?? "";
  const url = `${base}${path}`;

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);

  let lastError: IuFetchError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(500 * attempt);
    }

    const response = await fetch(url, { ...init, headers });

    if (response.status !== 503) {
      const body = await parseBody<T>(response);
      return { body, headers: response.headers, status: response.status };
    }

    lastError = new IuFetchError(503, `503 on attempt ${attempt + 1}`);
  }

  throw lastError ?? new IuFetchError(503, "all attempts returned 503");
}

// ── Native per-provider gateway ──────────────────────────────────────────────
// The IU unified endpoint exposes one route+dialect per provider. The
// OpenAI-compat aggregator (/openai/v1) silently fails for Anthropic/Gemini, so
// chat must be routed to each provider's native endpoint. `provider` is the
// catalog provider key (see deriveProvider).

export type GatewayDialect = "anthropic" | "gemini" | "openai";

export function dialectForProvider(provider: string): GatewayDialect {
  if (provider === "anthropic") return "anthropic";
  if (provider === "google") return "gemini";
  // openai + everything the gateway proxies through litellm (mistral, qwen, …)
  return "openai";
}

const ANTHROPIC_VERSION = "2023-06-01";

export interface RawResponse {
  status: number | "timeout";
  body: string;
  headers: Headers | null;
}

/** Low-level authenticated fetch that always returns the body as text, so error
 *  payloads survive for classification. Maps abort/timeout to status "timeout". */
export async function rawFetch(url: string, init: RequestInit = {}): Promise<RawResponse> {
  const key = process.env["IU_API_KEY"] ?? "";
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  try {
    const resp = await fetch(url, { ...init, headers });
    return { status: resp.status, body: await resp.text(), headers: resp.headers };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { status: "timeout", body: name, headers: null };
    }
    return { status: 0, body: err instanceof Error ? err.message : String(err), headers: null };
  }
}

export interface GatewayChatResult extends RawResponse {
  /** Assistant text when the response parsed cleanly; null otherwise. */
  text: string | null;
}

function extractAssistantText(dialect: GatewayDialect, raw: string): string | null {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (dialect === "anthropic") {
      const content = body["content"] as Array<{ text?: string }> | undefined;
      return content?.[0]?.text ?? null;
    }
    if (dialect === "gemini") {
      const candidates = body["candidates"] as
        | Array<{ content?: { parts?: Array<{ text?: string }> } }>
        | undefined;
      return candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    }
    const choices = body["choices"] as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/** Sends a single-turn chat to the provider's native gateway route. */
export async function gatewayChat(opts: {
  model: string;
  provider: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<GatewayChatResult> {
  const dialect = dialectForProvider(opts.provider);
  let url: string;
  let payload: unknown;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (dialect === "anthropic") {
    url = `${process.env["IU_ANTHROPIC_BASE_URL"] ?? ""}/messages`;
    headers["anthropic-version"] = ANTHROPIC_VERSION;
    payload = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: opts.prompt }],
    };
  } else if (dialect === "gemini") {
    url = `${process.env["IU_GEMINI_BASE_URL"] ?? ""}/models/${opts.model}:generateContent`;
    payload = {
      contents: [{ parts: [{ text: opts.prompt }] }],
      generationConfig: {
        maxOutputTokens: opts.maxTokens,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      },
    };
  } else {
    url = `${process.env["IU_OPENAI_BASE_URL"] ?? ""}/chat/completions`;
    payload = {
      model: opts.model,
      messages: [{ role: "user", content: opts.prompt }],
      // Reasoning models (o-series, gpt-5+) reject max_tokens; the modern field
      // works across the OpenAI-dialect models the gateway serves.
      max_completion_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    };
  }

  const res = await rawFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  return { ...res, text: extractAssistantText(dialect, res.body) };
}

export function parseResidency(headers: Headers): Residency {
  const region = (headers.get("x-ms-region") ?? "").toLowerCase();
  const server = (headers.get("x-middleware-forwarded-server") ?? "").toLowerCase();

  if (region.includes("sweden") || server.includes("sweden")) {
    return "eu";
  }
  if (server.includes("openai vendor") || server.includes("openai-vendor")) {
    return "us";
  }
  return "unknown";
}
