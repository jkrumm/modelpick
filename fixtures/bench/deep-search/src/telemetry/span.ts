import { log } from "./logger.ts";

/** Logs the start and end of a named unit of work. */
export function span<T>(name: string, work: () => T): T {
  log("debug", `${name} start`);
  const value = work();
  log("debug", `${name} end`);
  return value;
}
