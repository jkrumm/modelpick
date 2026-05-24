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

export function parseResidency(headers: Headers): Residency {
  const region = (headers.get("x-ms-region") ?? "").toLowerCase();
  const server = (
    headers.get("x-middleware-forwarded-server") ?? ""
  ).toLowerCase();

  if (region.includes("sweden") || server.includes("sweden")) {
    return "eu";
  }
  if (server.includes("openai vendor") || server.includes("openai-vendor")) {
    return "us";
  }
  return "unknown";
}
