/** True when a tracking code matches the carrier's format. */
export function isTrackingCode(code: string): boolean {
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code);
}
