/**
 * What the IU Anthropic route is really made of.
 *
 * The gateway answers every `/messages` call with two headers naming the
 * backend it forwarded to and the upstream model id it used:
 *
 *   x-middleware-forwarded-server: AWS Bedrock eu-west-1
 *   x-middleware-forwarded-model:  eu.anthropic.claude-opus-5
 *
 * That second value is the load-bearing one. Bedrock inference profiles carry
 * their routing scope in the prefix — `eu.` stays inside the EU, `global.` may
 * leave it — so two ids that look interchangeable in the catalog can have
 * different data residency. `claude-sonnet-4-6` is the sharp edge: the plain id
 * resolves to Vertex **us-east**, while `claude-sonnet-4-6-eu` is Bedrock
 * eu-west-1. Nothing in `GET /models` says so.
 *
 * This is a survey, not a probe of model quality — it costs 8 output tokens per
 * id. `bun run scripts/route-map.ts` renders it.
 *
 * Distinct from `parseResidency()` in ../iu/client.ts, which classifies the
 * whole IU gateway from the Azure/OpenAI header pair and only knows eu/us/
 * unknown. This one reads the Bedrock inference profile, so it can name the
 * third case that actually matters here: `global`.
 */
import { rawFetch } from "../iu/client.js";

const ANTHROPIC_VERSION = "2023-06-01";

/** Where a request actually landed, as the gateway reports it. */
export interface RouteBackend {
  modelId: string;
  status: number | "timeout";
  /** `x-middleware-forwarded-server`, e.g. "AWS Bedrock eu-west-1". */
  server: string | null;
  /** `x-middleware-forwarded-model`, e.g. "eu.anthropic.claude-opus-5". */
  upstreamModel: string | null;
  latencyMs: number;
}

/** Residency as far as the forwarded ids let us claim it. `eu` only when the
 *  backend is an EU region AND the inference profile is EU-scoped — a `global.`
 *  profile on an EU endpoint can still route elsewhere, which is precisely the
 *  distinction the `-eu` ids exist to make. */
export type RouteResidency = "eu" | "global" | "us" | "unknown";

export function classifyResidency(backend: RouteBackend): RouteResidency {
  const server = backend.server ?? "";
  const upstream = backend.upstreamModel ?? "";
  if (upstream.startsWith("global.")) return "global";
  if (upstream.startsWith("eu.")) return "eu";
  if (/useast|us-east|us-west|uscentral/i.test(server)) return "us";
  if (/eu-west|europe|sweden|west1/i.test(server)) return "eu";
  return "unknown";
}

function anthropicBase(): string {
  return process.env["IU_ANTHROPIC_BASE_URL"] ?? "";
}

/**
 * One minimal call, read for its headers rather than its body. `max_tokens: 8`
 * keeps a survey of the whole route in small change.
 */
export async function probeRoute(modelId: string): Promise<RouteBackend> {
  const started = Date.now();
  const r = await rawFetch(`${anthropicBase()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  return {
    modelId,
    status: r.status,
    server: r.headers?.get("x-middleware-forwarded-server") ?? null,
    upstreamModel: r.headers?.get("x-middleware-forwarded-model") ?? null,
    latencyMs: Date.now() - started,
  };
}

/** Markdown table in the house style — minimum separators, no padding. */
export function renderRouteMap(backends: RouteBackend[]): string {
  const lines = ["| model | status | backend | upstream id | residency | ms |", "|-|-|-|-|-|-|"];
  for (const b of backends) {
    const residency = b.status === 200 ? classifyResidency(b) : "—";
    lines.push(
      `| ${b.modelId} | ${b.status} | ${b.server ?? "—"} | ${b.upstreamModel ?? "—"} | ${residency} | ${b.latencyMs} |`,
    );
  }
  return lines.join("\n");
}
