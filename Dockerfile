# ============================================================
# Stage 1: install all deps and build the Nitro SSR server
# ============================================================
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# routeTree.gen.ts must already be committed; tsr generate is wired into
# the typecheck script but not the build script, so route generation is
# handled at dev-time before the image is built.
RUN bun run build

# ============================================================
# Stage 2: runtime image — SSR server + refresh scripts
# ============================================================
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Production deps only — scripts/refresh.ts imports drizzle-orm, postgres, etc.,
# all of which are production deps. devDeps (vite, nitro, oxlint) are not needed
# at runtime; Bun strips TypeScript types without them.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Built Nitro SSR server (self-contained Rollup bundle — no node_modules needed
# for the server itself, but Bun must be present to run .mjs on Alpine).
COPY --from=builder /app/.output ./.output

# Scripts + source needed for `docker exec ... bun run scripts/refresh.ts`
# (daily cron runs probe → collect → recommend → news via this mechanism).
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY tsconfig.json ./
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts ./

# Public dir — static assets. /app/public/demos is volume-mounted in prod
# so audio demos survive container restarts and rollhook redeploys.
COPY public/ ./public/

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

CMD ["bun", "run", ".output/server/index.mjs"]
