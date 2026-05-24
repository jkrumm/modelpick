import { defineConfig } from "drizzle-kit";

const url = process.env["DATABASE_URL"] ?? "";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  migrations: { schema: "modelpick" },
});
