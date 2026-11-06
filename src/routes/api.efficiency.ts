import { createFileRoute } from "@tanstack/react-router";
import { loadEfficiency } from "~/server/efficiency/load";

// Data feed Argo relays (contract: src/server/efficiency/types.ts). Always fresh: the AA rows
// change once a day and the route table is cached server-side.
export const Route = createFileRoute("/api/efficiency")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return new Response(JSON.stringify(await loadEfficiency()), {
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
