.PHONY: dev build db-push db-seed

# Local-only app: a single SQLite file (modelpick.db, gitignored). No docker.

# Create/sync the SQLite schema from src/db/schema.ts, then seed it.
db-push:
	bun run db:push

db-seed:
	bun run db:seed

dev:
	bun run dev

build:
	bun run build
