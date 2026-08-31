/** The feature flags this process was started with. */
export function featureFlags(): string[] {
  const raw = process.env.FEATURE_FLAGS ?? "";
  return raw
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0);
}

/** True when `name` is switched on. */
export function flagEnabled(name: string): boolean {
  return featureFlags().includes(name);
}
