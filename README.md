# modelpick

A public, daily-refreshed dashboard that ranks the LLM / TTS / STT models accessible via the IU
unified endpoint, cross-checked against external leaderboards, plus an interactive audio playground
for trialling and curating voice demos.

## Quick start

```bash
cp .env.example .env
# fill in .env values (or resolve from 1Password)
make up
```

The app runs at `http://localhost:3001`. Postgres runs on port 5433.

## Development

```bash
make db-up   # start local Postgres
make dev     # start dev server (or: bun run dev)
make down    # stop everything
```

## Env

See `.env.example` for required variables. Copy to `.env` and fill in values. The `.env` file is
gitignored — never commit real keys.

## Validation

```bash
bun run typecheck   # TypeScript
bun run lint        # linting
bun run test        # Vitest unit tests
bun run build       # SSR build
```

## Deploy

Deployed at `modelpick.jkrumm.com` via Cloudflare Tunnel + Traefik + RollHook on the shared VPS.
Push to `master` → GitHub Actions builds the image, pushes to the registry, triggers RollHook.

### First-time setup (run on the VPS, SSH in first)

**1. Create the `modelpick` database user + schema on the shared Postgres:**

```bash
cd ~/vps
ENV=prod make postgres-setup
```

**2. Create the demos directory (audio files persist across redeploys):**

```bash
sudo mkdir -p /var/lib/modelpick/demos
sudo chown -R $(id -u):$(id -g) /var/lib/modelpick/demos
```

**3. Add secrets to 1Password (`vps` vault):**

- `op://vps/modelpick/DB_PASSWORD` — generate: `openssl rand -hex 24`
- `op://vps/modelpick/ADMIN_KEY` — generate: `openssl rand -hex 20`
- `op://vps/modelpick/OPENROUTER_API_KEY` — from openrouter.ai/keys
- `op://vps/modelpick/ARTIFICIALANALYSIS_API_KEY` — from artificialanalysis.ai

**4. Materialize the env file for RollHook:**

```bash
ENV=prod make modelpick-env
```

**5. Bootstrap the initial image** (so RollHook has a running container for OIDC auth):

```bash
docker login rollhook.jkrumm.com -u jkrumm
docker pull rollhook.jkrumm.com/modelpick:latest || \
  docker build -t rollhook.jkrumm.com/modelpick:latest . && \
  docker push rollhook.jkrumm.com/modelpick:latest
ENV=prod make modelpick-up
```

**6. Apply migrations and seed the model catalog:**

```bash
ENV=prod make modelpick-migrate
ENV=prod make modelpick-seed
```

**7. Set up the Cloudflare DNS record** using the `/cloudflare` skill:

```bash
# modelpick.jkrumm.com → ${VPS_TAILSCALE_IP} (grey cloud / DNS-only, Tailscale-routed)
# or → CF tunnel (orange cloud, CF-proxied) — match the existing *.jkrumm.com pattern
```

**8. Set up the daily refresh cron** (on the VPS as the `jkrumm` user):

```bash
# /etc/cron.d/modelpick-refresh
0 6 * * * jkrumm docker exec $(docker ps --filter 'label=com.docker.compose.service=modelpick' --format '{{.Names}}' | head -1) bun run scripts/refresh.ts 2>&1 | logger -t modelpick-refresh
```

**9. Add GitHub Actions secrets** to `jkrumm/modelpick`:

- `ZOT_PASSWORD` — from `op://common/zot/PASSWORD`
- `ROLLHOOK_URL` — `https://rollhook.jkrumm.com`
- `ROLLHOOK_SECRET` — from `op://vps/rollhook/SECRET`

After this, every push to `master` deploys automatically.

### Manual operations

```bash
# Trigger a redeploy without a code change
git commit --allow-empty -m "chore: redeploy" && git push

# Run the daily refresh manually
ENV=prod make modelpick-refresh    # on the VPS

# Apply new migrations after a schema change
ENV=prod make modelpick-migrate
```
