/** The back-off delays, in milliseconds, for `attempts` retries. */
export function backoffPlan(attempts: number): number[] {
  const out: number[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) out.push(2 ** attempt * 100);
  return out;
}
