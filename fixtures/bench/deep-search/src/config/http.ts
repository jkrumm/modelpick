/** The base URL every outbound call is made against. */
export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "https://api.example.com";
}

/** The default `Accept` header for outbound calls. */
export function defaultAccept(): string {
  return "application/json";
}
