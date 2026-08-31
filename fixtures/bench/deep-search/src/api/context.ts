/** Everything a handler is given about the caller. */
export interface RequestContext {
  requestId: string;
  locale: string;
}

/** A context for background work that has no real caller. */
export function systemContext(): RequestContext {
  return { requestId: "system", locale: "en" };
}
