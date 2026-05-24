/**
 * Applies pending Drizzle migrations against DATABASE_URL.
 * Reads the generated SQL in drizzle/, splits on breakpoints, and runs each
 * statement with the postgres.js driver directly — avoids a drizzle-kit bug
 * (0.31.x) where Postgres NOTICE messages from idempotent DDL (CREATE SCHEMA
 * IF NOT EXISTS) cause the CLI migrate command to exit non-zero.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "";
const MIGRATIONS_DIR = join(import.meta.dirname, "../drizzle");
const MIGRATIONS_SCHEMA = "modelpick";
const MIGRATIONS_TABLE = "__drizzle_migrations";

const sql = postgres(DATABASE_URL, {
  max: 1,
  onnotice: () => {
    /* suppress NOTICE from idempotent DDL */
  },
});

async function ensureTrackingTable(): Promise<void> {
  await sql.unsafe(
    `CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`,
  );
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`,
  );
}

async function getApplied(): Promise<Set<string>> {
  const rows = await sql<
    { hash: string }[]
  >`SELECT hash FROM ${sql(MIGRATIONS_SCHEMA + "." + MIGRATIONS_TABLE)}`;
  return new Set(rows.map((r) => r.hash));
}

async function applyFile(file: string, hash: string): Promise<void> {
  const content = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
  const statements = content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await sql.unsafe(stmt);
  }

  await sql`
    INSERT INTO ${sql(MIGRATIONS_SCHEMA + "." + MIGRATIONS_TABLE)} (hash, created_at)
    VALUES (${hash}, ${Date.now()})
  `;
}

async function run(): Promise<void> {
  await ensureTrackingTable();
  const applied = await getApplied();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .toSorted();

  let count = 0;
  for (const file of files) {
    const hash = file.replace(/\.sql$/, "");
    if (applied.has(hash)) {
      console.log(`  skip  ${file}`);
      continue;
    }
    console.log(`  apply ${file}`);
    await applyFile(file, hash);
    count++;
  }

  if (count === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(`Applied ${count} migration(s).`);
  }

  await sql.end();
}

run().catch((e: unknown) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
