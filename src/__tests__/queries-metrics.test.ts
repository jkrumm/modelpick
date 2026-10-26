import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The db module opens its client at import time, so point it at a scratch file first.
const dir = mkdtempSync(join(tmpdir(), "modelpick-queries-"));
process.env["DATABASE_URL"] = `file:${join(dir, "test.db")}`;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("getLatestMetricsBySourceMetric", () => {
  let latest: Awaited<
    ReturnType<typeof import("../db/queries.js").getLatestMetricsBySourceMetric>
  >;

  beforeAll(async () => {
    const { db } = await import("../db/index.js");
    const { sql } = await import("drizzle-orm");
    const { getLatestMetricsBySourceMetric } = await import("../db/queries.js");
    await db.run(sql`CREATE TABLE metric_snapshot (
      id integer PRIMARY KEY AUTOINCREMENT,
      model_id text NOT NULL,
      source text NOT NULL,
      metric text NOT NULL,
      value real NOT NULL,
      confidence real,
      conditions text,
      captured_at text NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    )`);
    await db.run(sql`INSERT INTO metric_snapshot (model_id, source, metric, value, captured_at) VALUES
      ('m1', 'eqbench', 'quality', 9, '2026-01-01 00:00:00'),
      ('m1', 'artificialanalysis', 'quality', 1, '2026-01-01 00:00:00'),
      ('m1', 'artificialanalysis', 'quality', 2, '2026-01-02 00:00:00')`);
    latest = await getLatestMetricsBySourceMetric();
  });

  it("never returns rows from a retired source", () => {
    expect(latest.map((r) => r.source)).not.toContain("eqbench");
  });

  it("keeps only the newest row per (model, source, metric)", () => {
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ source: "artificialanalysis", value: 2 });
  });
});
