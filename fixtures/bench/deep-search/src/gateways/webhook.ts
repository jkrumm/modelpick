/** True when a webhook signature header looks well-formed. */
export function isWellFormedSignature(header: string): boolean {
  return /^t=\d+,v1=[a-f0-9]{64}$/.test(header);
}
