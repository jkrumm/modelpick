// The `/node` subpath, not the bare `@libsql/client`. The bare entry resolves
// through an export map with a `browser` condition, and Vite picks that one for
// its dev SSR graph — which hands the SSR server the Web-standard-APIs client,
// the one build that refuses a `file:` URL. Production builds resolved to node
// and worked, so the failure only ever showed up under `vite dev`, as
// URL_SCHEME_NOT_SUPPORTED on any route that queries. The `/node` subpath has no
// `browser` condition to pick, so both dev and build land on the same client.
import { createClient } from "@libsql/client/node";
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
