# modelpick — collector and benchmark internals

*Moved out of `CLAUDE.md` to keep it dense. The one-line rules stay there; this is
the how and why behind the Epoch AI collector and the ccbench harness.*

## Epoch AI benchmark collector

`src/server/collectors/epoch.ts` pulls Epoch AI's public benchmark export
(`https://epoch.ai/data/benchmark_data.zip` — no key, no auth) and is the only
source here that links back to real Inspect-AI eval transcripts rather than
reprinting a vendor's own claim. It covers benchmarks AA has no column for at
all: `swe_bench_verified`, `arc_agi`/`arc_agi_2`, `frontiermath`,
`aider_polyglot`, and more. **Licensed CC-BY 4.0 — attribution to Epoch AI is a
licence condition**, carried in the collector's header comment and in the
generated snapshot; don't strip it if this data moves anywhere else.

`benchmark_metadata.csv` (unzipped) drives everything: it names each
benchmark's `source_file` and `score_column`, so no column is ever hardcoded
per-file. Two things this source needs that the others don't:

- **Reasoning-effort suffixes.** Epoch appends
  `_none/_unknown/_low/_medium/_high/_xhigh/_max` to `Model version` for every
  model it re-ran across effort settings, giving one model several rows per
  benchmark. `stripEffortSuffix()` keeps exactly one row per model per
  benchmark — the *highest* available tier, since that's what a headline
  leaderboard number means once tiers exist. Matched on a literal underscore
  only (`glm-5.2_max` strips; `qwen3.7-max`, a real model name, does not).
- **Scale normalization.** Raw scores are on whatever scale the benchmark uses
  (e.g. percentages); `scale` from the index normalizes every value onto the
  same 0–1 range as `random_baseline`/`score_ceiling` before it's stored.

The committed snapshot `src/server/collectors/epoch-benchmarks.ts` (regenerated
wholesale on every `bun run collect`, same relationship as `iu-catalog.ts` ↔
`import-portal.ts`) captures per-benchmark
`random_baseline`/`score_ceiling`/`in_eci`/`release_date`/`superseded_by` and
exports `benchmarkSaturation()` — given a benchmark and its observed scores,
reports what share of the field sits near the ceiling, i.e. whether the
benchmark stopped discriminating between models (the ccbench-field-bunching
problem, but data-driven instead of eyeballed).

## ccbench internals — things that bite

`bun run bench` (`scripts/bench.ts`, `src/server/bench/`) copies a committed
fixture into a throwaway sandbox, spawns `claude -p` against the IU
**Anthropic** route with the model pinned on all four `ANTHROPIC_DEFAULT_*`
tiers, parses the stream-json transcript into metrics, and grades the
resulting files mechanically. Rows land in `bench_run`.

- **It spends real money.** `--yes` is required non-interactively, mirroring
  `pick`. `--dry-run` exercises the whole pipeline against a synthetic
  transcript and costs nothing.
- **Never remove the isolated `CLAUDE_CONFIG_DIR`.** Without it the global
  CLAUDE.md, MCP servers, extra tools and hooks load into every sandbox (71
  tools / 35k cache-creation tokens vs 27 / 20.5k) and the run measures
  dotfiles instead of the model.
- **Parallel tool use is detected by grouping assistant events on
  `message.id`** — the CLI emits one content block per event, so counting per
  event always yields 1. The `usage` object repeats identically across those
  events; totals must come from the `result` event or they multiply.
- **The CLI's cost figure is only valid for Claude ids.** For everything else
  it applies a Claude-tier default (over by up to 77x). `src/server/bench/cost.ts`
  re-prices from token counts against `pick_probe` rates; `--reprice` backfills
  stored rows. A zero-token run is `unpriced`, never free.
- **Graders are guarded by golden-solution tests.** Every file-based task
  asserts 1.00 against a committed reference under
  `fixtures/bench/<task>/.solution/`, plus a negative control. A
  silently-broken grader and a genuinely perfect field produce the same table
  without them.
- `bun run route-map` surveys where each id physically lands, from the
  gateway's `x-middleware-forwarded-*` headers — the only place residency is
  visible.
