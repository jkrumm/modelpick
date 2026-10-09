import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Alert,
  Badge,
  Box,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import { IconInfoCircle } from "@tabler/icons-react";
import { AxisBottom } from "@visx/axis";
import {
  AxisLeftNumeric,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  ClientOnly,
  Group as VxGroup,
  GridColumns,
  GridRows,
  scaleLinear,
  TooltipBody,
  TooltipRow,
  useChartTooltip,
  useTooltipStyles,
  useVxTheme,
  VX,
  type LegendEntry,
} from "~/charts";
import { formatDuration, formatUsd, MISSING } from "~/server/bench/format";
import { isUnreliable } from "~/server/bench/decision-metrics";
import type { DecisionSummary, DecisionTableRow } from "~/server/bench/decision-summary";
import { getDecisionSummary } from "./-decision-server-fns";

export const Route = createFileRoute("/decision")({
  loader: async () => getDecisionSummary(),
  component: DecisionPage,
});

// ── formatting ───────────────────────────────────────────────────────────────

/** One decimal: a saturated suite separates models by tenths of a point, which
 *  the shared whole-percent `formatPct` would round away. */
function pct1(value: number | null): string {
  return value === null ? MISSING : `${(value * 100).toFixed(1)}%`;
}

function brierText(value: number | null): string {
  return value === null ? MISSING : value.toFixed(4);
}

const REGION_BADGE: Record<DecisionTableRow["region"], string> = {
  eu: "green",
  us: "orange",
  unknown: "gray",
};

const REGION_COLOR: Record<DecisionTableRow["region"], string> = {
  eu: VX.series.eu,
  us: VX.series.us,
  unknown: VX.series.other,
};

const LEGEND: LegendEntry[] = (["eu", "us", "unknown"] as const).map((region) => ({
  key: region,
  label: region,
  color: REGION_COLOR[region],
  shape: "bar" as const,
}));

function RegionBadge({ row }: { row: DecisionTableRow }) {
  return (
    <Tooltip
      label={
        row.region === "eu"
          ? "EU-hosted only, per the IU model listing."
          : row.region === "unknown"
            ? "No region established for this route."
            : "Region read from the access probe's response headers."
      }
    >
      <Badge color={REGION_BADGE[row.region]} size="xs" variant="light">
        {row.region}
      </Badge>
    </Tooltip>
  );
}

// ── pick + consumers ─────────────────────────────────────────────────────────

function PickCard({ summary }: { summary: DecisionSummary }) {
  const { pick, consumers } = summary;
  if (pick === null) {
    return (
      <Paper withBorder p="md">
        <Text size="sm" c="dimmed">
          No decision pick recorded — add a `decision` row to MY_STACK in src/db/seed.ts.
        </Text>
      </Paper>
    );
  }
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group gap="sm" align="baseline">
          <Text size="sm" fw={600}>
            Current pick
          </Text>
          <Text size="md" fw={700} ff="monospace">
            {pick.model_id}
          </Text>
          <Text size="xs" c="dimmed">
            decided {pick.decided_at}
          </Text>
        </Group>
        {pick.rationale !== null && <Text size="sm">{pick.rationale}</Text>}
        {pick.env_note !== null && (
          <Text size="xs" c="dimmed">
            {pick.env_note}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          Record:{" "}
          <Text component="span" ff="monospace" size="xs">
            {summary.doc}
          </Text>
        </Text>

        <Text size="sm" fw={600} mt="xs">
          Consumers
        </Text>
        {consumers.length === 0 ? (
          <Text size="xs" c="dimmed">
            Nothing runs a decision model — a pick with no consumer is an idea, not a deployment.
          </Text>
        ) : (
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Slot</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th>Wired in</Table.Th>
                <Table.Th>Verified</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {consumers.map((c) => (
                <Table.Tr key={`${c.service}/${c.slot}`}>
                  <Table.Td>
                    <Text size="sm">
                      {c.service} / {c.slot}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {c.label}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace" fw={c.model_id === pick.model_id ? 700 : 400}>
                      {c.model_id}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {c.config_ref}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{c.verified_at ?? MISSING}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Paper>
  );
}

// ── ranking ──────────────────────────────────────────────────────────────────

function RowFlags({ row }: { row: DecisionTableRow }) {
  return (
    <Group gap={4} wrap="nowrap">
      {row.isPick && (
        <Badge color="blue" size="xs" variant="filled">
          pick
        </Badge>
      )}
      <RegionBadge row={row} />
      {row.accessible === false && (
        <Tooltip label="The latest access probe failed for this model.">
          <Badge color="red" size="xs" variant="light">
            inaccessible
          </Badge>
        </Tooltip>
      )}
      {isUnreliable(row) && (
        <Tooltip label="More than 10% of bench calls failed — ranked below every reliable model.">
          <Badge color="red" size="xs" variant="light">
            unreliable
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

function RankingTable({ rows }: { rows: DecisionTableRow[] }) {
  return (
    <ScrollArea>
      <Table verticalSpacing="xs" highlightOnHover striped="even">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>Model</Table.Th>
            <Table.Th ta="right">Accuracy</Table.Th>
            <Table.Th ta="right">Brier</Table.Th>
            <Table.Th ta="right">p50</Table.Th>
            <Table.Th ta="right">$ / 1k calls</Table.Th>
            <Table.Th ta="right">Errors</Table.Th>
            <Table.Th ta="right">Refusals</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row, index) => (
            <Table.Tr key={row.model} opacity={isUnreliable(row) ? 0.55 : 1}>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {index + 1}
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <Tooltip label={row.note ?? row.displayName}>
                    <Text size="sm" ff="monospace" fw={row.isPick ? 700 : 400}>
                      {row.model}
                    </Text>
                  </Tooltip>
                  <RowFlags row={row} />
                </Group>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm" fw={600}>
                  {pct1(row.accuracy)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{brierText(row.brier)}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{formatDuration(row.latencyP50Ms)}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{formatUsd(row.costPer1kCallsUsd)}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm" c={(row.errorRate ?? 0) > 0 ? "red" : "dimmed"}>
                  {pct1(row.errorRate)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">{pct1(row.refusalRate)}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function SuiteTable({ summary }: { summary: DecisionSummary }) {
  return (
    <ScrollArea>
      <Table verticalSpacing="xs" highlightOnHover withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Model</Table.Th>
            {summary.suites.map((suite) => (
              <Table.Th key={suite.id} ta="right" style={{ whiteSpace: "nowrap" }}>
                <Tooltip label={suite.description}>
                  <Text size="xs">
                    {suite.id} ({suite.cases})
                  </Text>
                </Tooltip>
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {summary.rows.map((row) => (
            <Table.Tr key={row.model}>
              <Table.Td>
                <Text size="xs" ff="monospace" style={{ whiteSpace: "nowrap" }}>
                  {row.model}
                </Text>
              </Table.Td>
              {summary.suites.map((suite) => {
                const accuracy = row.suiteAccuracy[suite.id] ?? null;
                return (
                  <Table.Td key={suite.id} ta="right">
                    <Badge
                      color={accuracy === null ? "gray" : accuracy >= 1 ? "green" : "yellow"}
                      size="sm"
                      variant="light"
                    >
                      {pct1(accuracy)}
                    </Badge>
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

// ── chart: calibration vs latency ────────────────────────────────────────────

const MARGIN = { top: 16, right: 24, bottom: 44, left: 56 };
const PLOT_HEIGHT = 240;
const TOTAL_HEIGHT = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;

interface Point {
  model: string;
  latencyMs: number;
  brier: number;
  accuracy: number;
  region: DecisionTableRow["region"];
  isPick: boolean;
}

function CalibrationChart({ points, width }: { points: Point[]; width: number }) {
  const theme = useVxTheme();
  const tooltipStyles = useTooltipStyles();
  const { tip, show, hide, tooltipRef } = useChartTooltip<Point>();

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 10);
  const innerH = PLOT_HEIGHT;

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, Math.max(...points.map((p) => p.latencyMs), 1) * 1.1],
        range: [0, innerW],
        nice: true,
      }),
    [points, innerW],
  );
  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, Math.max(...points.map((p) => p.brier), 0.01) * 1.15],
        range: [innerH, 0],
        nice: true,
      }),
    [points, innerH],
  );

  return (
    <ChartCard
      title="Calibration vs latency"
      subtitle="Brier score against median call time — bottom-left is sharp and fast."
      tooltip="Brier is the squared error of the returned probabilities (lower is better). On a suite where every model is accurate it is what separates them: a model that is confidently right scores near zero, one that hedges scores higher."
    >
      <svg width={width} height={TOTAL_HEIGHT}>
        <VxGroup top={MARGIN.top} left={MARGIN.left}>
          <GridRows scale={yScale} width={innerW} stroke={VX.grid} />
          <GridColumns scale={xScale} height={innerH} stroke={VX.grid} />

          {points.map((point) => (
            <circle
              key={point.model}
              cx={xScale(point.latencyMs)}
              cy={yScale(point.brier)}
              r={point.isPick ? 8 : tip?.data.model === point.model ? 8 : 6}
              fill={REGION_COLOR[point.region]}
              stroke={point.isPick ? VX.warnSolid : "none"}
              strokeWidth={2}
              opacity={tip === null || tip.data.model === point.model ? 0.9 : 0.35}
              style={{ cursor: "pointer", transition: "r 0.1s, opacity 0.1s" }}
              onMouseMove={(event) => show(point, event)}
              onMouseLeave={hide}
            />
          ))}

          <AxisLeftNumeric scale={yScale} numTicks={5} />
          <AxisBottom
            top={innerH}
            scale={xScale}
            numTicks={5}
            tickFormat={(value) => `${Number(value)}ms`}
            tickLabelProps={{ fill: theme.axis, fontSize: VX.axisFont, textAnchor: "middle" }}
            stroke={theme.axisStroke}
            tickStroke={theme.axisStroke}
          />
          <text
            x={-innerH / 2}
            y={-42}
            transform="rotate(-90)"
            fontSize={10}
            fill={theme.axis}
            textAnchor="middle"
          >
            Brier (lower is better)
          </text>
          <text x={innerW / 2} y={innerH + 38} fontSize={10} fill={theme.axis} textAnchor="middle">
            p50 latency
          </text>
        </VxGroup>
      </svg>

      <ChartLegend items={LEGEND} />

      <ChartTooltip tip={tip} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && (
          <TooltipBody>
            <TooltipRow
              color={REGION_COLOR[tip.data.region]}
              label={tip.data.model}
              value={tip.data.region}
            />
            <TooltipRow
              color={VX.series.quality}
              label="accuracy"
              value={pct1(tip.data.accuracy)}
            />
            <TooltipRow color={VX.series.cost} label="Brier" value={brierText(tip.data.brier)} />
            <TooltipRow
              color={VX.series.speed}
              label="p50"
              value={formatDuration(tip.data.latencyMs)}
            />
          </TooltipBody>
        )}
      </ChartTooltip>
    </ChartCard>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

function DecisionPage() {
  const summary = Route.useLoaderData();
  const [chartRef, chartEntry] = useResizeObserver<HTMLDivElement>();

  const points = useMemo<Point[]>(
    () =>
      summary.rows.flatMap((row) =>
        row.brier === null || row.latencyP50Ms === null || row.accuracy === null
          ? []
          : [
              {
                model: row.model,
                latencyMs: row.latencyP50Ms,
                brier: row.brier,
                accuracy: row.accuracy,
                region: row.region,
                isPick: row.isPick,
              },
            ],
      ),
    [summary.rows],
  );

  if (summary.rows.length === 0) {
    return (
      <Stack gap="xl" pt="md">
        <Title order={2}>Decision</Title>
        <Paper p="xl" withBorder ta="center">
          <Text c="dimmed" size="sm">
            The decision bench has not run yet. Run{" "}
            <Text component="span" ff="monospace" size="sm">
              bun run bench:decision
            </Text>{" "}
            first (about $0.06).
          </Text>
        </Paper>
      </Stack>
    );
  }

  return (
    <Stack gap="xl" pt="md">
      <Box>
        <Title order={2}>Decision</Title>
        <Text size="xs" c="dimmed">
          Typed-answer classifiers — yes/no, choice and score questions answered with probabilities,
          no text generation. Graded on email-gateway's own questions
          {summary.measuredAt !== null && <>, measured {summary.measuredAt}</>}.
        </Text>
      </Box>

      <PickCard summary={summary} />

      {summary.pickIsNotTop && (
        <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
          <Text size="xs">
            The pick is not the bench's top row. Accuracy is near-saturated on these suites, so the
            order below leans on calibration and latency; the pick weighs EU hosting and call time
            on top of that. The reasoning is in the record.
          </Text>
        </Alert>
      )}

      <Box>
        <Title order={4} mb="xs">
          Ranking
        </Title>
        <Paper withBorder p="xs">
          <RankingTable rows={summary.rows} />
        </Paper>
      </Box>

      <Box>
        <Title order={4} mb="xs">
          Accuracy per suite
        </Title>
        <Paper withBorder p="xs">
          <SuiteTable summary={summary} />
        </Paper>
      </Box>

      <Box ref={chartRef}>
        {points.length > 0 && (
          <ClientOnly fallbackHeight={TOTAL_HEIGHT}>
            <CalibrationChart points={points} width={chartEntry?.width ?? 600} />
          </ClientOnly>
        )}
      </Box>

      {summary.unbenched.length > 0 && (
        <Box>
          <Title order={4} mb="xs">
            Catalogued, not benched
          </Title>
          <Stack gap={4}>
            {summary.unbenched.map((row) => (
              <Group key={row.model} gap="xs">
                <Text size="sm" ff="monospace">
                  {row.model}
                </Text>
                <RegionBadge row={row} />
                <Text size="xs" c="dimmed">
                  {row.note ?? row.displayName}
                </Text>
              </Group>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
