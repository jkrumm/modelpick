/**
 * Raw configuration reads. Nothing outside `src/config/` calls these directly —
 * downstream code takes the typed accessors instead.
 */

/** The configured payment mode, or `test` when nothing is set. */
export function readPaymentMode(): string {
  return process.env.PAYMENT_MODE ?? "test";
}

/** The configured log level, or `info` when nothing is set. */
export function readLogLevel(): string {
  return process.env.LOG_LEVEL ?? "info";
}

/** True when the process was started with verbose tracing. */
export function readTracing(): boolean {
  return process.env.TRACE === "1";
}
