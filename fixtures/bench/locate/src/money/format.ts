/** Formats an already-decimal euro number, e.g. `12.34` -> `"12.34 EUR"`. */
export function formatEuroAmount(euro: number): string {
  return `${euro.toFixed(2)} EUR`;
}

/** Formats a ratio in [0, 1] as a percentage string. */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)} %`;
}
