/** Severity of a log line. */
export type LogLevel = "info" | "warn" | "error";

/**
 * Writes one line to stderr. This is the only output door in the package —
 * nothing else may write to the process streams directly.
 */
export function log(level: LogLevel, message: string): void {
  process.stderr.write(`[${level}] ${message}\n`);
}
