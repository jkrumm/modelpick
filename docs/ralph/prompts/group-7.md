# Group 7: visx chart primitives (ported from Argo)

## What You're Doing

Port the visx chart primitive system from Argo so every modelpick chart composes the same theme-aware
building blocks — no raw `@visx/tooltip`, no hand-rolled legends, no hex literals. This is the chart
foundation Group 8 builds on.

## Research & Exploration First

1. **Read `~/.claude/rules/visx-charts.md` fully** — it is the contract (ChartCard / ChartLegend /
   ChartTooltip / AxisLeftNumeric / AxisBottomDate / HoverOverlay / HoverContext / useChartTooltip /
   tokens `VX` / `useVxTheme`).
2. **Read the actual chart primitives in `~/SourceRoot/argo`** (find the `charts/` dir) — port their
   structure, adapting from Argo's theme system to Mantine's color scheme + dark/light.
3. Verify the current visx package set + versions via WebFetch (airbnb.io/visx) before installing.

## What to Implement

1. **`app/charts/tokens.ts`** — `VX` semantic palette (good/bad/warn/grid/crosshair…), per-metric series
   colors, theme-dependent neutrals as `*Dark`/`*Light` pairs.
2. **`useVxTheme()`** + a `ThemeContext` that tracks Mantine's color scheme and re-renders charts on toggle.
3. **Primitives**: `ChartCard`, `ChartLegend` (line|bar|split shapes), `ChartTooltip` + `TooltipHeader`
   /`TooltipRow`/`TooltipBody`, `AxisLeftNumeric`, `AxisBottomDate`, `HoverOverlay`, `HoverContext`,
   `useChartTooltip`.
4. Keep them generic (accessors `getX`/`getY`, declarative props) — config-first, not a god `<Chart type>`.

## Validation

```bash
bun run typecheck && bun run lint
bun run test        # render smoke tests for the primitives (no hex literals; theme resolves)
```

## Commit

```
feat(charts): port visx primitive system + theme tokens from Argo
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 7
```
