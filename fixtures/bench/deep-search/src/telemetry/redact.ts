const SECRET_KEYS = ["password", "token", "secret", "apiKey"];

/** Replaces the value of every secret-looking key with `***`. */
export function redact(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = SECRET_KEYS.includes(key) ? "***" : value;
  }
  return out;
}
