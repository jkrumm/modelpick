import type { ProbeStatus } from "../../db/schema.js";

export interface ProbeClassification {
  status: ProbeStatus;
  /** Short human-readable reason, persisted for catalog insight. Null when available. */
  error: string | null;
}

/**
 * Classifies a probe outcome from the HTTP status and response body.
 *
 * The IU gateway collapses many distinct conditions onto non-2xx codes (and
 * even 200-adjacent ones), so the *body* is where the truth is. We map each
 * observed signature onto a stable `ProbeStatus`. A model is treated as usable
 * (`accessible`) only for `available` and `throttled`.
 *
 * Order matters: more specific signatures are matched before generic ones.
 */
export function classifyProbe(input: {
  status: number | "timeout";
  body: string;
}): ProbeClassification {
  if (input.status === "timeout") {
    return { status: "timeout", error: "probe timed out" };
  }
  if (input.status >= 200 && input.status < 300) {
    return { status: "available", error: null };
  }

  const body = input.body.toLowerCase();
  const snippet = input.body.replace(/\s+/g, " ").trim().slice(0, 240);
  const has = (...needles: string[]): boolean => needles.some((n) => body.includes(n));

  // Rate / usage caps — the model exists and works, just temporarily limited.
  if (has("usage limit", "rate limit", "regain access", "too many requests", "quota exceeded")) {
    return { status: "throttled", error: snippet };
  }

  // A pure request-shape quibble means the route reached the live model and it
  // validated parameters — i.e. it IS reachable. Treat as available.
  if (has("max_tokens", "max_completion_tokens", "unsupported parameter", "unsupported value")) {
    return { status: "available", error: null };
  }

  // IU-side credential/auth misconfiguration for an upstream vendor.
  if (
    has(
      "incorrect api key",
      "invalid_api_key",
      "invalid api key",
      "missing or invalid authorization",
      "missing authorization",
      "couldn't authenticate",
      "unable authenticate",
      "permission denied",
      "authentication",
    )
  ) {
    return { status: "backend_error", error: snippet };
  }

  // No upstream provider/backend is wired for this model on the gateway, or the
  // id is listed (portal/discovery) but not actually callable / not a chat model.
  if (
    has(
      "no suitable backend",
      "no providers available",
      "no provider available",
      "no first line providers",
      "not a virtual model",
      "no model_name",
      "does not have access",
      "does not exist",
      "not found",
      "statuscode: notfound",
      "is not a chat model",
      "only supported in v1/responses",
      "requires the use of",
      "not supported for generatecontent",
    )
  ) {
    return { status: "not_routed", error: snippet };
  }

  // Route reached the model but rejected our payload shape.
  if (has("invalid json payload", "unknown name", "cannot find field", "unknown field")) {
    return { status: "bad_request", error: snippet };
  }

  return { status: "unknown", error: snippet || `HTTP ${input.status}` };
}

/** Whether a probe outcome counts as usable for recommendations. */
export function isAccessible(status: ProbeStatus): boolean {
  return status === "available" || status === "throttled";
}
