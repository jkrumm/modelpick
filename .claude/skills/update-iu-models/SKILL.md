---
name: update-iu-models
description: Refresh the IU model catalog in modelpick from a check-key portal HTML export — parse, diff, sync, seed, optionally probe, and commit the snapshot. Trigger when the user mentions a new IU model list, the check-key page (ue-self-service.app.iu-it.org/check-key), an HTML/export they saved, or that the modelpick catalog looks stale or missing recent models.
---

# Update IU Models

Refreshes `src/db/iu-catalog.ts` (the committed IU catalog snapshot) and the database from a
fresh export of the IU self-service model list. The portal is a Blazor app behind SSO, so it
**cannot be fetched programmatically** — the user must save the page HTML first.

Inline skill — orchestrate in the main session, keep output tight.

## Steps

1. **Get the HTML export.** Ask the user to open
   <https://ue-self-service.app.iu-it.org/check-key>, ensure the full model list is rendered,
   and save the page (⌘S → "Web Page, HTML only") or copy the page source to a file.
   Default expected path: `~/Downloads/models.html`. Accept any path they give.
   - If they can't produce it, stop — there's no other source for the catalog.

2. **Import + regenerate snapshot.**
   ```bash
   bun run scripts/import-portal.ts <path-to-export.html>
   ```
   This parses the HTML, writes `src/db/iu-catalog.ts`, and upserts models into the DB if
   `DATABASE_URL` is set. Report the parsed count + per-modality breakdown it prints.

3. **Review the diff.** Show what changed in the snapshot:
   ```bash
   git diff --stat src/db/iu-catalog.ts && git diff src/db/iu-catalog.ts | grep -E '^\+.*id:' 
   ```
   Summarize **added** and **removed** model ids. New families/flagships are the interesting
   part — call them out (they may warrant `/investigate-models` and a My Stack review).

4. **Apply to DB.** The catalog snapshot is enough for build/tests, but to reflect changes in
   the local SQLite file:
   ```bash
   bun run db:push    # syncs schema → modelpick.db (only needed after a schema.ts change)
   bun run db:seed    # upserts models + My Stack
   ```

5. **Probe access (optional, costs IU tokens).** Listed ≠ callable. To refresh real
   accessibility + residency for the new models:
   ```bash
   bun run probe
   ```
   Skip unless the user wants live access data now (the daily `refresh` cron does this anyway).

6. **Commit.** Stage the regenerated snapshot and commit:
   `feat(iu): refresh model catalog from portal export`. Don't bundle unrelated changes.

## Notes

- Schema changes sync with `bun run db:push` (`drizzle-kit push`) — there is no migration
  folder. See CLAUDE.md → Database / schema changes.
- If new flagship models appeared, suggest running `/investigate-models` to check whether any
  My Stack pick is now outdated.
