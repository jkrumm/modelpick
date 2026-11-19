---
description: Efficiency data and release alerts: aa_variant, coding evidence, estimates caveat, ArtificialAnalysis terms, the /api/efficiency contract. Read when changing src/server/efficiency, src/server/alerts or api.efficiency.
paths: ["src/server/efficiency/**","src/server/alerts/**","src/routes/api.efficiency.ts"]
---

# Efficiency data and release alerts (detail: [`docs/pipelines.md`](../../docs/pipelines.md))

- `aa_variant` (PK `slug`) holds one row per ArtificialAnalysis slug, effort variants separate,
  upserted from the same fetch as the AA metrics. `release_alert` (PK `lineage`) records the ntfy
  release pushes already made. `src/server/efficiency/` is the pure domain (parse, estimates,
  superseded, route mapping, `coding.ts`); `GET /api/efficiency` contract:
  `src/server/efficiency/types.ts`, relayed by Argo, so a change to a field lands in Argo too.
- **Coding evidence.** Each variant's `coding` ({score, components}) comes from Epoch AI (CC-BY 4.0,
  credit Epoch where shown). The Epoch collector stores one `metric_snapshot` row per (model, benchmark,
  effort) with the effort in `conditions`, plus the top tier unconditioned (`conditions` NULL); a reader
  wanting one value per model filters NULL. CursorBench/SciCode/WebDev Arena/SWE-bench verified come from
  the `EPOCH_EXTRA_FILES` registry in `epoch.ts`. Formula and mapping: `docs/pipelines.md`.
- **ArtificialAnalysis terms:** use the API only (`/api/v2/language/models/free`), never scrape
  artificialanalysis.ai, and show attribution ("Source: Artificial Analysis
  (artificialanalysis.ai)") wherever the data appears; the endpoint response carries it.
- **Estimates caveat.** `tokensPerTaskEst` / `timePerTaskEstSec` are derived (AA's free tier has
  no tokens or time per task): rank correlation 0.69 with AA's published time per task, but
  overstated 2-4x for Anthropic/OpenAI and up to 21x for input-heavy models. Always named `Est`.
- AA's `coding_index` has been null on every row of the free API since about 2026-10-28; the stored
  metrics are stale and nothing consumes them.
- Release alerts: refresh step after collect; `NTFY_TOKEN` in `.env.tpl`, `NTFY_URL` injected into
  the refresh plist by `make refresh-setup` (private host, never committed);
  `MODELPICK_NOTIFY_DRY=1 bun run alerts` prints instead of publishing.
