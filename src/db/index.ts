import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

// Local SQLite file (libsql). Works under both node (the SSR server) and bun
// (the scripts). Override with DATABASE_URL=file:/abs/path.db if needed.
const url = process.env["DATABASE_URL"] ?? "file:modelpick.db";

const sqlite = createClient({ url });
export const db = drizzle(sqlite, { schema });

// Scripts call `await client.end()` to release the connection before the
// process exits — keep that name as a thin, idempotent shim over the client.
let closed = false;
export const client = {
  end: async (): Promise<void> => {
    if (closed) return;
    closed = true;
    sqlite.close();
  },
};
