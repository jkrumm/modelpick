/** The outcome of an operation that is expected to fail sometimes. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Wraps a successful value. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Wraps a failure. */
export function err<T>(error: string): Result<T> {
  return { ok: false, error };
}
