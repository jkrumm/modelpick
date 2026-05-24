export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeScore(raw: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp((raw - min) / (max - min), 0, 1);
}
