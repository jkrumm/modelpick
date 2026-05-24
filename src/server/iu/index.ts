import { createServerFn } from "@tanstack/react-start";
import { runProbe } from "./probe.js";

export { runProbe, probeModel } from "./probe.js";
export { parseResidency, IuFetchError } from "./client.js";
export type { ProbeResult } from "./probe.js";

export const probeServerFn = createServerFn().handler(() => runProbe());
