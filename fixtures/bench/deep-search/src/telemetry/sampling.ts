/** Whether a trace with this id should be kept, at a 1-in-`rate` sample. */
export function keepTrace(traceId: string, rate: number): boolean {
  if (rate <= 1) return true;
  let hash = 0;
  for (const char of traceId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % rate === 0;
}
