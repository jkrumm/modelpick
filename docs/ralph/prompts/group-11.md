# Group 11: Deploy artifacts

> **DANGER / SCOPE LIMIT:** Do **NOT** actually deploy, SSH into the VPS, touch Cloudflare, or run
> rollhook. This group only **prepares** the deployment artifacts and documents the hands-on steps. The
> real deploy is done by the user, interactively, with their own VPS + 1Password access. Never push.

## What You're Doing

Produce everything needed to deploy modelpick to the VPS at `modelpick.jkrumm.com` — a production
Dockerfile, a compose service definition for the VPS stack (reusing the existing Postgres, new
`modelpick` DB), Cloudflare tunnel ingress, rollhook config, and a prod env template — plus a README
deploy section. Artifacts only.

## Research & Exploration First

1. Read `~/SourceRoot/vps` to learn the existing compose stacks (networking/infra/monitoring), the
   Cloudflare tunnel ingress pattern, and how rollhook is wired there. Mirror those conventions.
2. Read `~/SourceRoot/rollhook` for the config shape.
3. Note: prod uses the **existing VPS Postgres** (new `modelpick` database), and secrets come from
   1Password at deploy time (`op://common/anthropic`, `op://vps/modelpick api secrets`). Use placeholders
   in tracked files — never real values (`~/.claude/rules/security.md`).

## What to Implement

1. **`Dockerfile`**: multi-stage Bun build → slim runtime serving the TanStack Start prod server.
2. **`docker-compose.prod.yml`** (or a service snippet to drop into the vps infra stack): the modelpick
   service, env via `op run` / env-file placeholders, pointing `DATABASE_URL` at the existing VPS Postgres
   `modelpick` DB. No secrets inline.
3. **Cloudflare tunnel ingress**: the `modelpick.jkrumm.com` hostname → service mapping snippet for the
   VPS tunnel config.
4. **rollhook config**: webhook-triggered rolling deploy entry for this service.
5. **Prod env template** (`.env.prod.example`) + **README deploy section**: exact hands-on steps the user
   runs (create `modelpick` DB, apply migrations, set CF DNS/ingress, register rollhook, prod cron for
   `bun run refresh`). Reference the `/cloudflare` skill for DNS/ingress.
6. **Makefile**: a `deploy` target documenting (not auto-running) the rollhook trigger.

## Validation

```bash
bun run typecheck && bun run lint
bun run test
bun run build       # prod build is clean
# Do NOT run docker build/deploy here unless trivially local; artifacts + docs are the deliverable.
```

## Commit

```
feat(deploy): Dockerfile, VPS compose, CF tunnel, rollhook + deploy docs
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 11
```
