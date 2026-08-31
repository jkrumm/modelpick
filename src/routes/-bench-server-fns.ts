import { createServerFn } from "@tanstack/react-start";
import { loadBenchSummary, type BenchSummary } from "~/server/bench/summary";

export type { BenchSummary };

/**
 * The whole `/bench` page in one read. Thin on purpose: every number, pick and
 * caveat is derived in `~/server/bench/summary`, which `scripts/cap.ts` calls
 * too — the page and the CLI must not be able to disagree.
 *
 * `suiteId` is nullable rather than absent so the loader and the suite selector
 * can share one entry point: null means "the newest suite that ranked a field".
 */
export const getBenchSummary = createServerFn({ method: "GET" })
  .inputValidator((input: { suiteId: string | null }) => input)
  .handler(async ({ data }): Promise<BenchSummary> => {
    return loadBenchSummary({ suiteId: data.suiteId });
  });
