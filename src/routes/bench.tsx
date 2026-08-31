import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Group,
  List,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import { IconAlertTriangle } from "@tabler/icons-react";
import { AxisBottom } from "@visx/axis";
import {
  AxisLeftNumeric,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  Group as VxGroup,
  GridColumns,
  GridRows,
  scaleLinear,
  scaleLog,
  TooltipBody,
  TooltipRow,
  useChartTooltip,
  useTooltipStyles,
  useVxTheme,
  VX,
  type LegendEntry,
} from "~/charts";
import {
  aaIntelligenceOf,
  caveatLines,
  formatContext,
  formatDuration,
  formatPct,
  formatRate,
  formatScore,
  formatUsd,
  MISSING,
  type BenchModelRow,
  type BenchPick,
  type BenchSummary,
  type PickRole,
} from "~/server/bench/summary";
import type { RouteResidency } from "~/server/bench/route";
import { getBenchSummary } from "./-bench-server-fns";

export const Route = createFileRoute("/bench")({
  loader: async () => getBenchSummary({ data: { suiteId: null } }),
  component: BenchPage,
});

// ── residency palette ────────────────────────────────────────────────────────
// Chart colours come from VX tokens only — never a raw hex (see the global
// visx-charts rule). Residency is the useful dimension to colour by here: the
// leaderboard is saturated on quality, so what separates the field visually is
// where the request physically lands.

const RESIDENCY_COLOR: Record<RouteResidency, string> = {
  eu: VX.series.eu,
  us: VX.series.us,
  global: VX.warnSolid,
  unknown: VX.series.other,
};

const RESIDENCY_BADGE: Record<RouteResidency, string> = {
  eu: "green",
  us: "orange",
  global: "yellow",
  unknown: "gray",
};

const LEGEND: LegendEntry[] = (["eu", "global", "us", "unknown"] as const).map((residency) => ({
  key: residency,
  label: residency,
  color: RESIDENCY_COLOR[residency],
  shape: "bar" as const,
}));

const PICK_LABEL: Record<PickRole, string> = {
  interactive: "Interactive",
  worker: "Unattended worker",
  eu: "EU-pinned",
};

const PICK_COLOR: Record<PickRole, string> = {
  interactive: "blue",
  worker: "teal",
  eu: "green",
};

// ── recommendation block ─────────────────────────────────────────────────────

function RecommendationRow({ pickRole, pick }: { pickRole: PickRole; pick: BenchPick | null }) {
  return (
    <Group gap="sm" wrap="nowrap" align="baseline">
      <Badge
        color={PICK_COLOR[pickRole]}
        size="sm"
        variant="light"
        w={140}
        style={{ flexShrink: 0 }}
      >
        {PICK_LABEL[pickRole]}
      </Badge>
      {pick === null ? (
        <Text size="sm" c="dimmed">
          no candidate this suite can support
        </Text>
      ) : (
        <>
          <Text size="sm" fw={600} ff="monospace" style={{ flexShrink: 0 }}>
            {pick.modelId}
          </Text>
          <Text size="xs" c="dimmed" style={{ lineHeight: 1.4 }}>
            {pick.why}
          </Text>
        </>
      )}
    </Group>
  );
}

// ── leaderboard ──────────────────────────────────────────────────────────────

/** Why a row is in the table but out of every pick. */
function RowFlags({ row }: { row: BenchModelRow }) {
  const flags: Array<{ label: string; color: string; hint: string }> = [];
  if (row.dead)
    flags.push({ label: "dead", color: "red", hint: "Listed by the route, 503 on every call." });
  if (row.incompatible)
    flags.push({
      label: "cc-incompatible",
      color: "red",
      hint: "Answers /messages but cannot run a Claude Code session.",
    });
  if (!row.measured)
    flags.push({ label: "not run", color: "gray", hint: "This suite never benchmarked it." });
  if (flags.length === 0) return null;
  return (
    <Group gap={4} wrap="nowrap">
      {flags.map((flag) => (
        <Tooltip key={flag.label} label={flag.hint}>
          <Badge color={flag.color} size="xs" variant="light">
            {flag.label}
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );
}

function LeaderboardTable({
  rows,
  picked,
  mixedBasis,
}: {
  rows: BenchModelRow[];
  picked: Set<string>;
  mixedBasis: boolean;
}) {
  return (
    <ScrollArea>
      <Table verticalSpacing="xs" highlightOnHover striped="even">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Model</Table.Th>
            <Table.Th ta="right">AA int</Table.Th>
            <Table.Th ta="right">AA code</Table.Th>
            <Table.Th ta="right">Composite</Table.Th>
            <Table.Th ta="right">Quality</Table.Th>
            <Table.Th ta="right">Pass</Table.Th>
            <Table.Th ta="right">Cost</Table.Th>
            {mixedBasis && <Table.Th>Basis</Table.Th>}
            <Table.Th ta="right">Wall</Table.Th>
            <Table.Th ta="right">Turns</Table.Th>
            <Table.Th ta="right">Tool err</Table.Th>
            <Table.Th ta="right">$/MTok in</Table.Th>
            <Table.Th ta="right">out</Table.Th>
            <Table.Th ta="right">Context</Table.Th>
            <Table.Th>Residency</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.modelId} opacity={row.eligible ? 1 : 0.55}>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" ff="monospace" fw={picked.has(row.modelId) ? 700 : 400}>
                    {row.modelId}
                  </Text>
                  <RowFlags row={row} />
                </Group>
              </Table.Td>
              <Table.Td ta="right">
                {row.aa === null || row.aa.intelligence === null ? (
                  <Text size="sm" c="dimmed">
                    {MISSING}
                  </Text>
                ) : (
                  <Tooltip
                    label={
                      row.aa.approximate
                        ? `ArtificialAnalysis rates "${row.aa.sourceId}" — a near neighbour, so read it as an upper bound.`
                        : `ArtificialAnalysis, captured ${row.aa.capturedAt ?? "—"}`
                    }
                  >
                    <Text size="sm">
                      {row.aa.intelligence.toFixed(1)}
                      {row.aa.approximate ? "~" : ""}
                    </Text>
                  </Tooltip>
                )}
              </Table.Td>
              <Table.Td ta="right">
                {row.aa === null || row.aa.coding === null ? (
                  <Text size="sm" c="dimmed">
                    {MISSING}
                  </Text>
                ) : (
                  <Text size="sm">{row.aa.coding.toFixed(1)}</Text>
                )}
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm" fw={600}>
                  {row.measured ? formatScore(row.composite) : MISSING}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                {row.measured && row.quality < 1 ? (
                  <Text size="sm" c="yellow" fw={600}>
                    {formatScore(row.quality)}
                  </Text>
                ) : (
                  <Text size="sm">{row.measured ? formatScore(row.quality) : MISSING}</Text>
                )}
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{row.measured ? formatPct(row.passRate) : MISSING}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{row.measured ? formatUsd(row.totalCostUsd) : MISSING}</Text>
              </Table.Td>
              {mixedBasis && (
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {row.measured ? row.costBasis : MISSING}
                  </Text>
                </Table.Td>
              )}
              <Table.Td ta="right">
                <Text size="sm">
                  {row.measured ? formatDuration(row.totalDurationMs) : MISSING}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{row.meanTurns === null ? MISSING : row.meanTurns.toFixed(1)}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{row.measured ? formatPct(row.toolErrorRate) : MISSING}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{formatRate(row.rate.inPerM)}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{formatRate(row.rate.outPerM)}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{formatContext(row.rate)}</Text>
              </Table.Td>
              <Table.Td>
                <Badge color={RESIDENCY_BADGE[row.residency]} size="xs" variant="light">
                  {row.residency}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

// ── per-task matrix ──────────────────────────────────────────────────────────

/**
 * A cell has three distinct states and they must not look alike: a clean pass,
 * a *low score* (the model worked and got some of it right), and a *failure* —
 * the run died on a timeout, a max-turns cut or an API error and never got to
 * be graded. Collapsing the last two is how "slow" gets read as "incapable".
 */
function MatrixCell({
  score,
  passed,
  failures,
}: {
  score: number | null;
  passed: boolean;
  failures: string[];
}) {
  if (score === null)
    return (
      <Text size="xs" c="dimmed" ta="center">
        {MISSING}
      </Text>
    );

  if (failures.length > 0) {
    return (
      <Tooltip label={`Run did not complete: ${failures.join(", ")} — score ${score.toFixed(2)}`}>
        <Badge color="red" size="xs" variant="filled" fullWidth>
          {failures[0]} {score.toFixed(2)}
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Badge color={passed ? "green" : "yellow"} size="xs" variant="light" fullWidth>
      {score.toFixed(2)}
    </Badge>
  );
}

function TaskMatrix({ summary, rows }: { summary: BenchSummary; rows: BenchModelRow[] }) {
  const byKey = useMemo(
    () => new Map(summary.cells.map((cell) => [`${cell.modelId} ${cell.taskId}`, cell])),
    [summary.cells],
  );

  return (
    <ScrollArea>
      <Table verticalSpacing="xs" highlightOnHover withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Model</Table.Th>
            {summary.taskIds.map((taskId) => (
              <Table.Th key={taskId} style={{ whiteSpace: "nowrap" }}>
                <Text size="xs">{taskId}</Text>
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.modelId}>
              <Table.Td>
                <Text size="xs" ff="monospace" style={{ whiteSpace: "nowrap" }}>
                  {row.modelId}
                </Text>
              </Table.Td>
              {summary.taskIds.map((taskId) => {
                const cell = byKey.get(`${row.modelId} ${taskId}`);
                return (
                  <Table.Td key={taskId}>
                    <MatrixCell
                      score={cell?.score ?? null}
                      passed={cell?.passed ?? false}
                      failures={cell?.failures ?? []}
                    />
                  </Table.Td>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

// ── Pareto chart: cost (log) vs external intelligence ────────────────────────

const PARETO_MARGIN = { top: 16, right: 24, bottom: 44, left: 52 };
const PARETO_HEIGHT = 260;

interface ParetoPoint {
  modelId: string;
  cost: number;
  intelligence: number;
  quality: number;
  durationMs: number;
  residency: RouteResidency;
}

function ParetoChart({ points, width }: { points: ParetoPoint[]; width: number }) {
  const theme = useVxTheme();
  const tooltipStyles = useTooltipStyles();
  const { tip, show, hide, tooltipRef } = useChartTooltip<ParetoPoint>();

  const innerW = Math.max(width - PARETO_MARGIN.left - PARETO_MARGIN.right, 10);
  const innerH = PARETO_HEIGHT;

  const xScale = useMemo(() => {
    const costs = points.map((p) => p.cost);
    // A log axis cannot hold a zero, and a suite whose cheapest run rounds to
    // nothing still has to plot — so the domain is padded rather than clamped.
    const min = Math.min(...costs, 0.01);
    const max = Math.max(...costs, min * 10);
    return scaleLog<number>({ domain: [min / 2, max * 2], range: [0, innerW] });
  }, [points, innerW]);

  const yScale = useMemo(() => {
    const values = points.map((p) => p.intelligence);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    return scaleLinear<number>({
      domain: [Math.max(0, min - 5), max + 5],
      range: [innerH, 0],
      nice: true,
    });
  }, [points, innerH]);

  const height = innerH + PARETO_MARGIN.top + PARETO_MARGIN.bottom;

  return (
    <ChartCard
      title="Cost vs external intelligence"
      subtitle="Log cost per suite run against the ArtificialAnalysis index — bottom-left is cheap and weak, top-left is the bargain."
      tooltip="X is what the whole suite cost this model (log scale), Y is ArtificialAnalysis's intelligence index. ccbench quality is deliberately not the Y axis: it is saturated across the field and would draw a flat line."
    >
      <svg width={width} height={height}>
        <VxGroup top={PARETO_MARGIN.top} left={PARETO_MARGIN.left}>
          <GridRows scale={yScale} width={innerW} stroke={VX.grid} />
          <GridColumns scale={xScale} height={innerH} stroke={VX.grid} />

          {points.map((point) => (
            <circle
              key={point.modelId}
              cx={xScale(point.cost)}
              cy={yScale(point.intelligence)}
              r={tip?.data.modelId === point.modelId ? 8 : 6}
              fill={RESIDENCY_COLOR[point.residency]}
              opacity={tip === null || tip.data.modelId === point.modelId ? 0.9 : 0.35}
              style={{ cursor: "pointer", transition: "r 0.1s, opacity 0.1s" }}
              onMouseMove={(event) => show(point, event)}
              onMouseLeave={hide}
            />
          ))}

          <AxisLeftNumeric scale={yScale} numTicks={5} />
          <AxisBottom
            top={innerH}
            scale={xScale}
            numTicks={4}
            tickFormat={(value) => formatUsd(Number(value))}
            tickLabelProps={{ fill: theme.axis, fontSize: VX.axisFont, textAnchor: "middle" }}
            stroke={theme.axisStroke}
            tickStroke={theme.axisStroke}
          />
          <text
            x={-innerH / 2}
            y={-40}
            transform="rotate(-90)"
            fontSize={10}
            fill={theme.axis}
            textAnchor="middle"
          >
            AA intelligence
          </text>
          <text x={innerW / 2} y={innerH + 38} fontSize={10} fill={theme.axis} textAnchor="middle">
            Suite cost (log)
          </text>
        </VxGroup>
      </svg>

      <ChartLegend items={LEGEND} />

      <ChartTooltip tip={tip} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && (
          <TooltipBody>
            <TooltipRow
              color={RESIDENCY_COLOR[tip.data.residency]}
              label={tip.data.modelId}
              value={tip.data.residency}
            />
            <TooltipRow
              color={VX.series.cost}
              label="suite cost"
              value={formatUsd(tip.data.cost)}
            />
            <TooltipRow
              color={VX.series.quality}
              label="AA intelligence"
              value={tip.data.intelligence.toFixed(1)}
            />
            <TooltipRow
              color={VX.series.speed}
              label="wall"
              value={formatDuration(tip.data.durationMs)}
            />
          </TooltipBody>
        )}
      </ChartTooltip>
    </ChartCard>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

function BenchPage() {
  const initial = Route.useLoaderData();
  const [summary, setSummary] = useState<BenchSummary>(initial);
  const [loading, setLoading] = useState(false);
  const [chartRef, chartEntry] = useResizeObserver<HTMLDivElement>();

  async function selectSuite(suiteId: string | null): Promise<void> {
    if (suiteId === null || suiteId === summary.suiteId) return;
    setLoading(true);
    try {
      setSummary(await getBenchSummary({ data: { suiteId } }));
    } finally {
      setLoading(false);
    }
  }

  const eligible = useMemo(() => summary.models.filter((row) => row.eligible), [summary.models]);
  const picked = useMemo(
    () =>
      new Set(
        [summary.picks.interactive, summary.picks.worker, summary.picks.eu]
          .filter((pick): pick is BenchPick => pick !== null)
          .map((pick) => pick.modelId),
      ),
    [summary.picks],
  );
  const paretoPoints = useMemo<ParetoPoint[]>(
    () =>
      eligible
        .filter((row) => row.totalCostUsd !== null && aaIntelligenceOf(row) !== null)
        .map((row) => ({
          modelId: row.modelId,
          cost: row.totalCostUsd ?? 0,
          intelligence: aaIntelligenceOf(row) ?? 0,
          quality: row.quality,
          durationMs: row.totalDurationMs,
          residency: row.residency,
        })),
    [eligible],
  );

  const suiteOptions = summary.suites.map((suite) => ({
    value: suite.suiteId,
    label: `${suite.suiteId} — ${suite.modelCount} models × ${suite.taskCount} tasks`,
  }));

  if (summary.suiteId === "") {
    return (
      <Stack gap="xl" pt="md">
        <Title order={2}>ccbench</Title>
        <Paper p="xl" withBorder ta="center">
          <Text c="dimmed" size="sm">
            No suite has ranked a field yet. Run{" "}
            <Text component="span" ff="monospace" size="sm">
              bun run bench
            </Text>{" "}
            first.
          </Text>
        </Paper>
      </Stack>
    );
  }

  return (
    <Stack gap="xl" pt="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Box>
          <Title order={2}>ccbench</Title>
          <Text size="xs" c="dimmed">
            Real `claude -p` sessions over the IU Anthropic route, graded mechanically — suite{" "}
            <Text component="span" ff="monospace" size="xs">
              {summary.suiteId}
            </Text>
            , {eligible.length} model(s) × {summary.taskIds.length} task(s)
            {summary.capturedAt !== null && <>, measured {summary.capturedAt}</>}.
          </Text>
        </Box>
        <Group gap="xs" align="center">
          {loading && <Loader size="xs" />}
          <Select
            size="xs"
            w={260}
            label="Suite"
            data={suiteOptions}
            value={summary.suiteId}
            onChange={(value) => void selectSuite(value)}
            allowDeselect={false}
          />
        </Group>
      </Group>

      <Paper withBorder p="md">
        <Stack gap="sm">
          <Text size="sm" fw={600}>
            Recommendation
          </Text>
          <RecommendationRow pickRole="interactive" pick={summary.picks.interactive} />
          <RecommendationRow pickRole="worker" pick={summary.picks.worker} />
          <RecommendationRow pickRole="eu" pick={summary.picks.eu} />
        </Stack>
      </Paper>

      <Alert
        icon={<IconAlertTriangle size={16} />}
        color="yellow"
        variant="light"
        title="Read the table with these"
      >
        <List size="xs" spacing={4}>
          {caveatLines(summary.caveats).map((line) => (
            <List.Item key={line}>{line}</List.Item>
          ))}
        </List>
      </Alert>

      <Box>
        <Title order={4} mb="xs">
          Leaderboard
        </Title>
        <Paper withBorder p="xs">
          <LeaderboardTable
            rows={summary.models}
            picked={picked}
            mixedBasis={summary.caveats.costBasis === "mixed"}
          />
        </Paper>
      </Box>

      <Box>
        <Title order={4} mb="xs">
          Per-task scores
        </Title>
        <Text size="xs" c="dimmed" mb="xs">
          Mean score across attempts. A red cell is a run that died — timeout, max turns or an API
          error — which is a different finding from a low score.
        </Text>
        <Paper withBorder p="xs">
          <TaskMatrix summary={summary} rows={eligible} />
        </Paper>
      </Box>

      <Box ref={chartRef}>
        {paretoPoints.length > 0 ? (
          <ParetoChart points={paretoPoints} width={chartEntry?.width ?? 600} />
        ) : (
          <ChartCard
            title="Cost vs external intelligence"
            tooltip="Needs both a priced suite run and an ArtificialAnalysis index for at least one model."
          >
            <Text size="sm" c="dimmed" ta="center" py="xl">
              No model in this suite has both a price and an external index — run{" "}
              <Text component="span" ff="monospace" size="sm">
                bun run collect
              </Text>{" "}
              first.
            </Text>
          </ChartCard>
        )}
      </Box>
    </Stack>
  );
}
