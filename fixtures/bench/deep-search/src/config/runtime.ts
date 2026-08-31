/** The deployment environment name. */
export function environment(): string {
  return process.env.NODE_ENV ?? "development";
}

/** True in the production deployment. */
export function isProduction(): boolean {
  return environment() === "production";
}
