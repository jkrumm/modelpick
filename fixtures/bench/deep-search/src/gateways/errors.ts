/** Gateway failures the caller is expected to distinguish. */
export type GatewayFailure = "declined" | "network" | "invalid" | "unknown";

/** Maps a gateway status code onto a failure kind. */
export function failureFor(status: number): GatewayFailure {
  if (status === 402) return "declined";
  if (status === 400 || status === 422) return "invalid";
  if (status >= 500) return "network";
  return "unknown";
}
