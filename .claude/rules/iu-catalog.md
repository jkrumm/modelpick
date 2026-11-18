---
description: IU model catalog sync: the live /models legs, iu_listed, HIDDEN_CALLABLE, the committed snapshot. Read when changing the sync, src/server/iu or src/db/iu-catalog.ts.
paths: ["scripts/sync-catalog.ts","src/server/iu/**","src/db/iu-catalog.ts"]
---

# IU model catalog — how it stays current

The catalog comes from the IU gateway's live per-leg `GET /models` endpoints (OpenAI,
Anthropic, Gemini, Decisions), which return exactly what the check-key page shows and
need only `IU_API_KEY` — no SSO, no HTML export. `make models` (`scripts/sync-catalog.ts`,
step 0 of `bun run refresh`) merges the legs by exact id (case-sensitive, verbatim),
upserts `models` (adds `owned_by` = the backend route list, the best residency hint, and
`legs` = the legs that accept the id) and sets `iu_listed=false` on vanished ids in one
transaction, and only then rewrites the committed snapshot `src/db/iu-catalog.ts` (tmp file +
rename); the refresh commits it only when the catalog step succeeded. A failing or empty
leg aborts before anything is written. It never deletes rows: probes and metrics hang off
them. Modality: ChatCompletion/Responses means `llm` even with Embedding/ImageGeneration/
audio capabilities listed (image-only models are the ones with ImageOutput or no
Functions); an id only the decisions leg lists is a `decision` model. `make models` also refreshes the
Replicate speech catalog. **Listed ≠ callable** — `make probe` (`bun run probe`) proves
real access and residency.

**`/models` is not complete.** `HIDDEN_CALLABLE` in `src/server/iu/catalog.ts` lists ids that
are callable and billed but in no leg (start: `claude-haiku-5-5-eu`); add one only after
`make probe` proves it callable. An id in no leg gets `iu_listed=false`
from the sync; rows are never deleted.
