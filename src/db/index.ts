import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "";

export const client = postgres(DATABASE_URL);
export const db = drizzle(client, { schema });

const moduleDir = dirname(fileURLToPath(import.meta.url));
// In dev: src/db/ → ../../drizzle; in built output the path resolves at runtime
const migrationsFolder = join(moduleDir, "../../drizzle");

export async function runMigrations(): Promise<void> {
  const migrationClient = postgres(DATABASE_URL, { max: 1 });
  await migrate(drizzle(migrationClient), {
    migrationsFolder,
    migrationsSchema: "modelpick",
  });
  await migrationClient.end();
}
