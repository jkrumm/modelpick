import { createFileRoute } from "@tanstack/react-router";
import { max } from "drizzle-orm";
import { db } from "~/db/index";
import { aaVariant } from "~/db/schema";

// Liveness for `make verify`. Reads SQLite, so a 200 proves server + DB path together.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [row] = await db.select({ capturedAt: max(aaVariant.updated_at) }).from(aaVariant);
          return new Response(JSON.stringify({ ok: true, capturedAt: row?.capturedAt ?? null }), {
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (err) {
          return new Response(JSON.stringify({ ok: false, error: String(err) }), {
            status: 503,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
