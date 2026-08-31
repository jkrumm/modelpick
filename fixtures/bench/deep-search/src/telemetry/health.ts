import { environment } from "../config/runtime.ts";
import { currentLevel } from "./logger.ts";
import { catalogSize } from "../services/catalog/page.ts";

/** What `/health` answers with. */
export interface Health {
  environment: string;
  logLevel: string;
  catalogSize: number;
}

/** The process health report. */
export function healthReport(): Health {
  return {
    environment: environment(),
    logLevel: currentLevel(),
    catalogSize: catalogSize(),
  };
}
