// Preloaded into the production server (`node --import` in the `start` script).
//
// The server runs under `secrets-run`, whose redaction filters are pipes. If a
// pipe reader dies first, every log write raises EPIPE; with Nitro's
// uncaughtException handler logging that error to the same dead stream, Node
// spun at 100% CPU for days as an orphan (2026-09-14). And srvx's graceful
// shutdown swallows every SIGTERM after the first, so a hung shutdown was
// killable only with SIGKILL.

const SHUTDOWN_GRACE_MS = 10_000;
const EXIT_EPIPE = 141; // 128 + SIGPIPE, what a default-disposition process reports
const EXIT_SIGTERM = 143; // 128 + SIGTERM

for (const stream of [process.stdout, process.stderr]) {
  // Any error on a log stream leaves nowhere to report it — exit, never rethrow.
  stream.on("error", (error) => process.exit(error.code === "EPIPE" ? EXIT_EPIPE : 1));
}

process.once("SIGTERM", () => {
  setTimeout(() => process.exit(EXIT_SIGTERM), SHUTDOWN_GRACE_MS).unref();
});
