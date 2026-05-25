import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import {
  ChartCard,
  Group as VxGroup,
  GridColumns,
  GridRows,
  Bar,
  scaleLinear,
  scaleBand,
  VX,
  useVxTheme,
} from "~/charts";
import type { Modality, ProbeStatus } from "~/db/schema";

const MODALITY_COLORS: Record<Modality, string> = {
  llm: "indigo",
  tts: "orange",
  stt: "green",
  image: "grape",
  embedding: "cyan",
};

// Per probe outcome: badge color, short label, and a fixed explanation for the
// accessible cases (non-accessible cases show the persisted error in the tooltip).
const PROBE_STATUS_META: Record<ProbeStatus, { color: string; label: string; hint: string }> = {
  available: { color: "green", label: "✓", hint: "Responds to a live call." },
  throttled: { color: "yellow", label: "throttled", hint: "Works but rate/usage-limited." },
  backend_error: {
    color: "orange",
    label: "backend",
    hint: "IU-side upstream key/auth misconfig.",
  },
  not_routed: { color: "gray", label: "not routed", hint: "No provider/backend on the gateway." },
  bad_request: {
    color: "grape",
    label: "bad req",
    hint: "Route reached the model but rejected the request shape.",
  },
  timeout: { color: "red", label: "timeout", hint: "No response before the probe timeout." },
  unknown: { color: "gray", label: "?", hint: "Unclassified non-2xx response." },
};

function ProbeStatusBadge({ status, error }: { status: ProbeStatus; error: string | null }) {
  const meta = PROBE_STATUS_META[status];
  return (
    <Tooltip label={error ?? meta.hint} multiline maw={360} withArrow>
      <Badge color={meta.color} size="xs" variant="light" style={{ cursor: "help" }}>
        {meta.label}
      </Badge>
    </Tooltip>
  );
}
import type { ModelMetrics } from "~/server/scoring/normalize";
import type { DeciderData } from "./-server-fns";
import { getDeciderData } from "./-server-fns";

export const Route = createFileRoute("/catalog")({
  loader: async () => getDeciderData(),
  component: CatalogPage,
});

const PROVIDER_COLOR: Record<string, string> = {
  anthropic: VX.series.anthropic,
  openai: VX.series.openai,
  google: VX.series.google,
  mistral: VX.series.mistral,
  deepseek: VX.series.deepseek,
  alibaba: VX.series.qwen,
  moonshot: VX.series.other,
  zhipu: VX.series.other,
  minimax: VX.series.other,
};

function providerColor(provider: string): string {
  return PROVIDER_COLOR[provider] ?? VX.series.other;
}

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${Math.round(v * 100)}`;
}

// Raw per-million-token price. Sub-$1 prices keep two decimals so cheap models
// don't all collapse to "0".
function price(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`;
}

function ResidencyBadge({ residency }: { residency: "eu" | "us" | "unknown" }) {
  if (residency === "eu")
    return (
      <Badge color="blue" size="xs" variant="light">
        EU
      </Badge>
    );
  if (residency === "us")
    return (
      <Badge color="orange" size="xs" variant="light">
        US
      </Badge>
    );
  return (
    <Badge color="gray" size="xs" variant="light">
      ?
    </Badge>
  );
}

// ── Scatter chart: Quality vs Cost ──────────────────────────────────────────

interface ScatterPoint {
  model_id: string;
  display_name: string;
  provider: string;
  quality: number | null;
  cost: number | null;
  modality: string;
}

const SCATTER_MARGIN = { top: 16, right: 24, bottom: 40, left: 50 };

function QualityPriceScatter({ points, width }: { points: ScatterPoint[]; width: number }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const theme = useVxTheme();
  const innerW = Math.max(width - SCATTER_MARGIN.left - SCATTER_MARGIN.right, 10);
  const innerH = 220;

  const xScale = useMemo(
    () => scaleLinear<number>({ domain: [0, 1], range: [0, innerW] }),
    [innerW],
  );
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, 1], range: [innerH, 0] }),
    [innerH],
  );

  const height = innerH + SCATTER_MARGIN.top + SCATTER_MARGIN.bottom;

  return (
    <ChartCard
      title="Quality vs Cost"
      tooltip="Quality (0=poor, 1=best) vs Cost efficiency (0=expensive, 1=cheap). Top-right = high quality + cheap."
    >
      <svg width={width} height={height}>
        <VxGroup top={SCATTER_MARGIN.top} left={SCATTER_MARGIN.left}>
          <GridRows scale={yScale} width={innerW} stroke={VX.grid} />
          <GridColumns scale={xScale} height={innerH} stroke={VX.grid} />

          {points.map((p) => {
            const cx = xScale(p.cost ?? 0);
            const cy = yScale(p.quality ?? 0);
            const isHovered = hovered === p.model_id;
            return (
              <g key={p.model_id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 8 : 6}
                  fill={providerColor(p.provider)}
                  opacity={hovered !== null && !isHovered ? 0.3 : 0.85}
                  style={{ cursor: "pointer", transition: "r 0.1s, opacity 0.1s" }}
                  onMouseEnter={() => setHovered(p.model_id)}
                  onMouseLeave={() => setHovered(null)}
                />
                {isHovered && (
                  <text
                    x={cx + 10}
                    y={cy + 4}
                    fontSize={10}
                    fill={theme.axis}
                    style={{ pointerEvents: "none" }}
                  >
                    {p.display_name}
                  </text>
                )}
              </g>
            );
          })}

          <AxisLeft
            scale={yScale}
            numTicks={5}
            tickFormat={(v) => `${Math.round(Number(v) * 100)}`}
            tickLabelProps={{ fill: theme.axis, fontSize: VX.axisFont, dx: -4 }}
            stroke={theme.axisStroke}
            tickStroke={theme.axisStroke}
          />
          <AxisBottom
            top={innerH}
            scale={xScale}
            numTicks={5}
            tickFormat={(v) => `${Math.round(Number(v) * 100)}`}
            tickLabelProps={{ fill: theme.axis, fontSize: VX.axisFont, textAnchor: "middle" }}
            stroke={theme.axisStroke}
            tickStroke={theme.axisStroke}
          />

          <text
            x={-innerH / 2}
            y={-36}
            transform="rotate(-90)"
            fontSize={10}
            fill={theme.axis}
            textAnchor="middle"
          >
            Quality
          </text>
          <text x={innerW / 2} y={innerH + 36} fontSize={10} fill={theme.axis} textAnchor="middle">
            Cost efficiency
          </text>
        </VxGroup>
      </svg>
    </ChartCard>
  );
}

// ── Bar chart: Speed scores ──────────────────────────────────────────────────

interface BarDatum {
  model_id: string;
  label: string;
  speed: number;
  provider: string;
}

const BAR_MARGIN = { top: 8, right: 24, bottom: 32, left: 130 };
const BAR_HEIGHT = 22;
const BAR_GAP = 4;

function ThroughputBars({ data, width }: { data: BarDatum[]; width: number }) {
  const theme = useVxTheme();
  const innerW = Math.max(width - BAR_MARGIN.left - BAR_MARGIN.right, 10);
  const innerH = data.length * (BAR_HEIGHT + BAR_GAP);

  const xScale = useMemo(
    () => scaleLinear<number>({ domain: [0, 1], range: [0, innerW] }),
    [innerW],
  );
  const yScale = useMemo(
    () =>
      scaleBand<string>({
        domain: data.map((d) => d.model_id),
        range: [0, innerH],
        padding: 0.2,
      }),
    [data, innerH],
  );

  const height = innerH + BAR_MARGIN.top + BAR_MARGIN.bottom;

  return (
    <ChartCard
      title="Speed Scores"
      tooltip="Normalized speed score (throughput + latency). Higher = faster."
    >
      <svg width={width} height={height}>
        <VxGroup top={BAR_MARGIN.top} left={BAR_MARGIN.left}>
          <GridColumns scale={xScale} height={innerH} stroke={VX.grid} />

          {data.map((d) => {
            const y = yScale(d.model_id) ?? 0;
            const barH = yScale.bandwidth();
            return (
              <g key={d.model_id}>
                <Bar
                  x={0}
                  y={y}
                  width={xScale(d.speed)}
                  height={barH}
                  fill={providerColor(d.provider)}
                  opacity={0.8}
                />
                <text x={xScale(d.speed) + 4} y={y + barH / 2 + 4} fontSize={9} fill={theme.axis}>
                  {Math.round(d.speed * 100)}
                </text>
              </g>
            );
          })}

          <AxisLeft
            scale={yScale}
            tickFormat={(v) => {
              const d = data.find((x) => x.model_id === v);
              const label = d?.label ?? v;
              return label.length > 18 ? label.slice(0, 17) + "…" : label;
            }}
            tickLabelProps={{
              fill: theme.axis,
              fontSize: 9,
              dx: -4,
              textAnchor: "end",
            }}
            stroke={theme.axisStroke}
            tickStroke={theme.axisStroke}
          />
          <AxisBottom
            top={innerH}
            scale={xScale}
            numTicks={5}
            tickFormat={(v) => `${Math.round(Number(v) * 100)}`}
            tickLabelProps={{ fill: theme.axis, fontSize: VX.axisFont, textAnchor: "middle" }}
            stroke={theme.axisStroke}
            tickStroke={theme.axisStroke}
          />
        </VxGroup>
      </svg>
    </ChartCard>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

type SortField =
  | "display_name"
  | "provider"
  | "quality"
  | "price_in"
  | "price_out"
  | "speed"
  | "score";
type SortDir = "asc" | "desc";

interface TableRow {
  model_id: string;
  display_name: string;
  provider: string;
  modality: Modality;
  quality: number | null;
  cost: number | null;
  price_in: number | null;
  price_out: number | null;
  speed: number | null;
  score: number;
  accessible: boolean;
  probe_status: ProbeStatus;
  probe_error: string | null;
  residency: "eu" | "us" | "unknown";
  latency_ms: number | null;
}

function SortTh({
  field,
  sortField,
  sortDir,
  onSort,
  children,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
  children: React.ReactNode;
}) {
  const active = sortField === field;
  return (
    <Table.Th
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      onClick={() => onSort(field)}
    >
      <Group gap={4} wrap="nowrap">
        {children}
        {active && (
          <Text size="xs" c="dimmed">
            {sortDir === "asc" ? "↑" : "↓"}
          </Text>
        )}
      </Group>
    </Table.Th>
  );
}

function ModelTable({
  rows,
  sortField,
  sortDir,
  onSort,
}: {
  rows: TableRow[];
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  return (
    <ScrollArea>
      <Table striped highlightOnHover withTableBorder withColumnBorders style={{ minWidth: 700 }}>
        <Table.Thead>
          <Table.Tr>
            <SortTh field="display_name" sortField={sortField} sortDir={sortDir} onSort={onSort}>
              Model
            </SortTh>
            <SortTh field="provider" sortField={sortField} sortDir={sortDir} onSort={onSort}>
              Provider
            </SortTh>
            <Table.Th>Type</Table.Th>
            <SortTh field="quality" sortField={sortField} sortDir={sortDir} onSort={onSort}>
              Quality
            </SortTh>
            <SortTh field="price_in" sortField={sortField} sortDir={sortDir} onSort={onSort}>
              <Tooltip label="Input price per 1M tokens" withArrow>
                <span>$/1M in</span>
              </Tooltip>
            </SortTh>
            <SortTh field="price_out" sortField={sortField} sortDir={sortDir} onSort={onSort}>
              <Tooltip label="Output price per 1M tokens" withArrow>
                <span>$/1M out</span>
              </Tooltip>
            </SortTh>
            <SortTh field="speed" sortField={sortField} sortDir={sortDir} onSort={onSort}>
              Speed
            </SortTh>
            <SortTh field="score" sortField={sortField} sortDir={sortDir} onSort={onSort}>
              Score
            </SortTh>
            <Table.Th>IU</Table.Th>
            <Table.Th>Residency</Table.Th>
            <Table.Th>Latency</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.model_id}>
              <Table.Td>
                <Text size="sm" fw={500}>
                  {row.display_name}
                </Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {row.model_id}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge
                  color="gray"
                  variant="light"
                  size="sm"
                  style={{ backgroundColor: providerColor(row.provider) + "22" }}
                >
                  {row.provider}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Badge color={MODALITY_COLORS[row.modality] ?? "gray"} variant="light" size="xs">
                  {row.modality.toUpperCase()}
                </Badge>
              </Table.Td>
              <Table.Td ta="right">{pct(row.quality)}</Table.Td>
              <Table.Td ta="right">{price(row.price_in)}</Table.Td>
              <Table.Td ta="right">{price(row.price_out)}</Table.Td>
              <Table.Td ta="right">{pct(row.speed)}</Table.Td>
              <Table.Td ta="right">
                <Text size="sm" fw={500}>
                  {pct(row.score)}
                </Text>
              </Table.Td>
              <Table.Td>
                <ProbeStatusBadge status={row.probe_status} error={row.probe_error} />
              </Table.Td>
              <Table.Td>
                <ResidencyBadge residency={row.residency} />
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs" c="dimmed">
                  {row.latency_ms !== null ? `${Math.round(row.latency_ms)}ms` : "—"}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function buildTableRows(
  data: DeciderData,
  iuOnly: boolean,
  currentOnly: boolean,
  modalityFilter: "all" | Modality,
  search: string,
): TableRow[] {
  const metricsMap = new Map<string, ModelMetrics>(data.modelMetrics.map((m) => [m.model_id, m]));
  const currentSet = new Set(data.currentIds);

  return data.models
    .filter((m) => {
      if (currentOnly && !currentSet.has(m.id)) return false;
      if (modalityFilter !== "all" && m.modality !== modalityFilter) return false;
      if (search.length > 0) {
        const q = search.toLowerCase();
        if (!m.display_name.toLowerCase().includes(q) && !m.provider.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (iuOnly) {
        const p = data.probes[m.id];
        if (p === undefined || !p.accessible) return false;
      }
      return true;
    })
    .map((m) => {
      const mm = metricsMap.get(m.id);
      const probe = data.probes[m.id];
      const raw = data.rawMetrics[m.id];
      const quality = mm?.quality ?? null;
      const cost = mm?.cost ?? null;
      const speed = mm?.speed ?? null;
      const score = (quality ?? 0) * 0.4 + (cost ?? 0) * 0.3 + (speed ?? 0) * 0.3;
      return {
        model_id: m.id,
        display_name: m.display_name,
        provider: m.provider,
        modality: m.modality,
        quality,
        cost,
        price_in: raw?.["price_in"] ?? null,
        price_out: raw?.["price_out"] ?? null,
        speed,
        score,
        accessible: probe?.accessible ?? false,
        probe_status: probe?.probe_status ?? "unknown",
        probe_error: probe?.error ?? null,
        residency: probe?.residency ?? "unknown",
        latency_ms: probe?.latency_ms ?? null,
      };
    });
}

function sortRows(rows: TableRow[], field: SortField, dir: SortDir): TableRow[] {
  return rows.toSorted((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp =
      typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return dir === "asc" ? cmp : -cmp;
  });
}

function CatalogPage() {
  const data = Route.useLoaderData();
  const [iuOnly, setIuOnly] = useState(false);
  const [currentOnly, setCurrentOnly] = useState(true);
  const [modalityFilter, setModalityFilter] = useState<"all" | Modality>("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [scatterRef, scatterEntry] = useResizeObserver<HTMLDivElement>();
  const [barRef, barEntry] = useResizeObserver<HTMLDivElement>();

  const filteredRows = useMemo(
    () => buildTableRows(data, iuOnly, currentOnly, modalityFilter, search),
    [data, iuOnly, currentOnly, modalityFilter, search],
  );

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortField, sortDir),
    [filteredRows, sortField, sortDir],
  );

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  // Scatter: all models with both quality and cost scores
  const scatterPoints = useMemo((): ScatterPoint[] => {
    return data.models
      .filter((m) => {
        const mm = data.modelMetrics.find((x) => x.model_id === m.id);
        return mm !== undefined && (mm.quality !== null || mm.cost !== null);
      })
      .map((m) => {
        const mm = data.modelMetrics.find((x) => x.model_id === m.id);
        return {
          model_id: m.id,
          display_name: m.display_name,
          provider: m.provider,
          quality: mm?.quality ?? null,
          cost: mm?.cost ?? null,
          modality: m.modality,
        };
      });
  }, [data]);

  // Bar: models with speed score, sorted
  const barData = useMemo((): BarDatum[] => {
    return data.modelMetrics
      .filter((mm) => mm.speed !== null)
      .map((mm) => {
        const model = data.models.find((m) => m.id === mm.model_id);
        return {
          model_id: mm.model_id,
          label: model?.display_name ?? mm.model_id,
          speed: mm.speed ?? 0,
          provider: model?.provider ?? "other",
        };
      })
      .toSorted((a, b) => b.speed - a.speed)
      .slice(0, 15);
  }, [data]);

  const scatterWidth = scatterEntry?.width ?? 600;
  const barWidth = barEntry?.width ?? 600;

  return (
    <Stack gap="xl" pt="md">
      <Title order={2}>Model Catalog</Title>

      <Paper p="md" withBorder>
        <Group gap="xl" wrap="wrap">
          <TextInput
            placeholder="Search models..."
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 200 }}
            size="sm"
          />
          <Box>
            <Text size="xs" c="dimmed" mb={4}>
              Modality
            </Text>
            <SegmentedControl
              value={modalityFilter}
              onChange={(v) => setModalityFilter(v as "all" | Modality)}
              data={[
                { label: "All", value: "all" },
                { label: "LLM", value: "llm" },
                { label: "TTS", value: "tts" },
                { label: "STT", value: "stt" },
                { label: "Image", value: "image" },
                { label: "Embedding", value: "embedding" },
              ]}
              size="xs"
            />
          </Box>
          <Tooltip
            label="Hide dated snapshot pins and models no longer tracked on leaderboards"
            withArrow
            multiline
            maw={260}
          >
            <Switch
              label="Current only"
              checked={currentOnly}
              onChange={(e) => setCurrentOnly(e.currentTarget.checked)}
              size="sm"
            />
          </Tooltip>
          <Switch
            label="IU only"
            checked={iuOnly}
            onChange={(e) => setIuOnly(e.currentTarget.checked)}
            size="sm"
          />
        </Group>
      </Paper>

      <Text size="sm" c="dimmed">
        {sortedRows.length} model{sortedRows.length !== 1 ? "s" : ""}
      </Text>

      <ModelTable rows={sortedRows} sortField={sortField} sortDir={sortDir} onSort={handleSort} />

      {scatterPoints.length > 0 || barData.length > 0 ? (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Box ref={scatterRef}>
            <QualityPriceScatter points={scatterPoints} width={scatterWidth} />
          </Box>
          <Box ref={barRef}>
            {barData.length > 0 ? (
              <ThroughputBars data={barData} width={barWidth} />
            ) : (
              <ChartCard
                title="Speed Scores"
                tooltip="Normalized speed score. No throughput data available yet."
              >
                <Text size="sm" c="dimmed" ta="center" py="xl">
                  No speed data — run{" "}
                  <Text component="span" ff="monospace" size="sm">
                    bun run collect
                  </Text>{" "}
                  first.
                </Text>
              </ChartCard>
            )}
          </Box>
        </SimpleGrid>
      ) : null}
    </Stack>
  );
}
