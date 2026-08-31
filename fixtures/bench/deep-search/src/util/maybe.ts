/** The first defined member of `values`, or undefined. */
export function firstDefined<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

/** `value` when it is defined, otherwise `fallback`. */
export function orElse<T>(value: T | undefined | null, fallback: T): T {
  return value === undefined || value === null ? fallback : value;
}
