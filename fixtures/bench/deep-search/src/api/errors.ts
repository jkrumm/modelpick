/** A request that could not be served, with the status the edge should return. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Wraps an unknown throwable as a 500. */
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(500, error instanceof Error ? error.message : "unknown error");
}
