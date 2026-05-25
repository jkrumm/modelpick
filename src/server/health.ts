import { defineEventHandler, setResponseStatus } from "h3";

let shuttingDown = false;

// Set flag on SIGTERM so health returns 503 before Nitro shuts down.
// Gives Traefik time to drain traffic before the process exits.
process.on("SIGTERM", () => {
  shuttingDown = true;
});

export default defineEventHandler((event) => {
  if (shuttingDown) {
    setResponseStatus(event, 503);
    return { ok: false };
  }
  return { ok: true };
});
