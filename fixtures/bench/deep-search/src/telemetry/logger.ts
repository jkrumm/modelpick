import { readLogLevel } from "../config/env-source.ts";

const ORDER = ["debug", "info", "warn", "error"];

/** The level this process logs at. */
export function currentLevel(): string {
  return readLogLevel();
}

/** True when a message at `level` should be written. */
export function shouldLog(level: string): boolean {
  return ORDER.indexOf(level) >= ORDER.indexOf(currentLevel());
}

/** Writes one line to stderr when the level allows it. */
export function log(level: string, message: string): void {
  if (shouldLog(level)) process.stderr.write(`[${level}] ${message}\n`);
}
