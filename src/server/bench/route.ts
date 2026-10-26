/**
 * Residency of an IU Anthropic-route id, as far as the gateway's forwarded headers
 * (`x-middleware-forwarded-server` / `-model`) let us claim it. Committed as a snapshot
 * in `models.ts` (`ROUTE_RESIDENCY`); the survey script that produced it was cut.
 *
 * `eu` only when the backend is an EU region AND the inference profile is EU-scoped — a
 * `global.` profile on an EU endpoint can still route elsewhere, which is precisely the
 * distinction the `-eu` ids exist to make.
 */
export type RouteResidency = "eu" | "global" | "us" | "unknown";
