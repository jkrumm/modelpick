import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconSearch } from "@tabler/icons-react";
import { METRIC_SOURCE } from "~/db/schema";
import {
  formatMetricValue,
  metricLabel,
  MISSING,
  parseMetricKey,
  sourceLabel,
} from "./-benchmarks-format";
import type { BenchmarkMatrixData, BenchmarkModelRow } from "./-benchmarks-server-fns";
import { getBenchmarkMatrixData } from "./-benchmarks-server-fns";

export const Route = createFileRoute("/benchmarks")({
  loader: async () => getBenchmarkMatrixData(),
  component: BenchmarksPage,
});

// Same cap catalog.tsx uses for its pin-to-compare interaction — this route
// owns its own pin state (a fresh useState below), not catalog's.
const MAX_PINNED = 6;

type SortDir = "asc" | "desc";
// A metric column key (see -benchmarks-format.ts) or one of the two fixed columns.
type SortField = "display_name" | "provider" | "coverage" | (string & {});

interface Column {
  key: string;
  source: string;
  metric: string;
}

/**
 * Every (source, metric) pair actually observed across the whole catalog,
 * grouped by source in canonical METRIC_SOURCE order (a source that isn't in
 * the enum yet — shouldn't happen, but costs nothing to handle — sorts last)
 * and alphabetically by metric within a source. Deriving this from the data
 * rather than a hardcoded list is the point: a newly-collected source or
 * metric shows up here with no code change.
 */
function discoverColumns(rows: BenchmarkModelRow[]): Column[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.metrics)) keys.add(key);
  }
  const columns = [...keys].map((key) => ({ key, ...parseMetricKey(key) }));
  const sourceOrder = new Map(METRIC_SOURCE.map((s, i) => [s as string, i]));
  columns.sort((a, b) => {
    const oa = sourceOrder.get(a.source) ?? METRIC_SOURCE.length;
    const ob = sourceOrder.get(b.source) ?? METRIC_SOURCE.length;
    if (oa !== ob) return oa - ob;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.metric.localeCompare(b.metric);
  });
  return columns;
}

/** Column -> list of columns sharing that source, in display order, used to
 *  size the grouped source header row's colSpans. */
function groupBySource(columns: Column[]): { source: string; columns: Column[] }[] {
  const groups: { source: string; columns: Column[] }[] = [];
  for (const col of columns) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.source === col.source) {
      last.columns.push(col);
    } else {
      groups.push({ source: col.source, columns: [col] });
    }
  }
  return groups;
}

function coverageOf(rows: BenchmarkModelRow[], key: string): number {
  let n = 0;
  for (const row of rows) {
    if (row.metrics[key] !== undefined) n++;
  }
  return n;
}

interface RowFilter {
  search: string;
  currentOnly: boolean;
  iuOnly: boolean;
  currentIds: Set<string>;
}

function filterRows(rows: BenchmarkModelRow[], filter: RowFilter): BenchmarkModelRow[] {
  const q = filter.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter.currentOnly && !filter.currentIds.has(r.model_id)) return false;
    if (filter.iuOnly && !r.accessible) return false;
    if (q.length > 0) {
      if (!r.display_name.toLowerCase().includes(q) && !r.provider.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}

function fieldValue(row: BenchmarkModelRow, field: SortField): string | number | undefined {
  if (field === "display_name") return row.display_name;
  if (field === "provider") return row.provider;
  // How many benchmarks this model has any value for. The default sort, because
  // alphabetical opens the page on TTS rows that carry no benchmark data at all —
  // a comparison table whose first screen is entirely em-dashes is useless.
  if (field === "coverage") return Object.keys(row.metrics).length;
  return row.metrics[field];
}

function sortRows(rows: BenchmarkModelRow[], field: SortField, dir: SortDir): BenchmarkModelRow[] {
  return rows.toSorted((a, b) => {
    const av = fieldValue(a, field);
    const bv = fieldValue(b, field);
    if (av === undefined && bv === undefined) return 0;
    if (av === undefined) return 1; // missing values always sort last, regardless of direction
    if (bv === undefined) return -1;
    const cmp =
      typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return dir === "asc" ? cmp : -cmp;
  });
}

// ── header ───────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return dir === "asc" ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />;
}

function MetricTh({
  column,
  sortField,
  sortDir,
  onSort,
  coverage,
  total,
}: {
  column: Column;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  coverage: number;
  total: number;
}) {
  const active = sortField === column.key;
  return (
    <Table.Th
      style={{ cursor: "pointer", whiteSpace: "nowrap" }}
      onClick={() => onSort(column.key)}
    >
      <Tooltip
        label={`${sourceLabel(column.source)} · ${column.metric} · ${coverage} of ${total} shown models have a value`}
        withArrow
        multiline
        maw={280}
      >
        <Stack gap={0} align="flex-end">
          <Group gap={2} wrap="nowrap">
            <Text size="xs" fw={500}>
              {metricLabel(column.metric)}
            </Text>
            <SortIcon active={active} dir={sortDir} />
          </Group>
          <Text size="9px" c="dimmed">
            {coverage}/{total}
          </Text>
        </Stack>
      </Tooltip>
    </Table.Th>
  );
}

function FixedTh({
  label,
  field,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <Table.Th style={{ cursor: "pointer" }} onClick={() => onSort(field)}>
      <Group gap={2} wrap="nowrap">
        <Text size="xs" fw={500}>
          {label}
        </Text>
        <SortIcon active={active} dir={sortDir} />
      </Group>
    </Table.Th>
  );
}

// ── matrix table ─────────────────────────────────────────────────────────────

function MatrixTable({
  rows,
  columns,
  sortField,
  sortDir,
  onSort,
  pinnedIds,
  onTogglePin,
}: {
  rows: BenchmarkModelRow[];
  columns: Column[];
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  pinnedIds: Set<string>;
  onTogglePin: (modelId: string) => void;
}) {
  const groups = useMemo(() => groupBySource(columns), [columns]);

  return (
    <ScrollArea>
      <Table striped highlightOnHover withTableBorder withColumnBorders style={{ minWidth: 900 }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            <Table.Th />
            <Table.Th />
            {groups.map((g) => (
              <Table.Th key={g.source} colSpan={g.columns.length} ta="center">
                <Text size="xs" fw={700} tt="uppercase">
                  {sourceLabel(g.source)}
                </Text>
              </Table.Th>
            ))}
          </Table.Tr>
          <Table.Tr>
            <Table.Th>Pin</Table.Th>
            <FixedTh
              label="Model"
              field="display_name"
              sortField={sortField}
              sortDir={sortDir}
              onSort={onSort}
            />
            <FixedTh
              label="Provider"
              field="provider"
              sortField={sortField}
              sortDir={sortDir}
              onSort={onSort}
            />
            {columns.map((col) => (
              <MetricTh
                key={col.key}
                column={col}
                sortField={sortField}
                sortDir={sortDir}
                onSort={onSort}
                coverage={coverageOf(rows, col.key)}
                total={rows.length}
              />
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => {
            const pinned = pinnedIds.has(row.model_id);
            const pinDisabled = !pinned && pinnedIds.size >= MAX_PINNED;
            return (
              <Table.Tr key={row.model_id}>
                <Table.Td>
                  <Tooltip
                    label={pinDisabled ? `Up to ${MAX_PINNED} pinned models` : "Pin to compare"}
                    withArrow
                    disabled={!pinDisabled}
                  >
                    <Checkbox
                      size="xs"
                      checked={pinned}
                      disabled={pinDisabled}
                      onChange={() => onTogglePin(row.model_id)}
                      aria-label={`Pin ${row.display_name} to compare`}
                    />
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {row.display_name}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {row.model_id}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge color="gray" variant="light" size="sm">
                    {row.provider}
                  </Badge>
                </Table.Td>
                {columns.map((col) => {
                  const v = row.metrics[col.key];
                  return (
                    <Table.Td key={col.key} ta="right">
                      <Text size="sm" {...(v === undefined ? { c: "dimmed" as const } : {})}>
                        {v === undefined ? MISSING : formatMetricValue(col.metric, v)}
                      </Text>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

// ── shared-benchmarks join panel ────────────────────────────────────────────

function ComparisonPanel({
  rows,
  allColumns,
  onUnpin,
  onClear,
}: {
  rows: BenchmarkModelRow[];
  allColumns: Column[];
  onUnpin: (modelId: string) => void;
  onClear: () => void;
}) {
  if (rows.length === 0) return null;

  // The actual cross-benchmark join: only the columns every pinned model has
  // a real value for — this is the honest answer to "compare these models",
  // as opposed to a wide table full of dashes wherever coverage doesn't overlap.
  const sharedColumns =
    rows.length >= 2
      ? allColumns.filter((col) => rows.every((r) => r.metrics[col.key] !== undefined))
      : [];

  return (
    <Paper p="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Text size="sm" fw={500}>
          Comparing {rows.length} model{rows.length !== 1 ? "s" : ""} (up to {MAX_PINNED})
        </Text>
        <Button variant="subtle" size="xs" onClick={onClear}>
          Clear all
        </Button>
      </Group>
      {rows.length < 2 ? (
        <Text size="sm" c="dimmed">
          Pin at least one more model to see the benchmarks they share.
        </Text>
      ) : sharedColumns.length === 0 ? (
        <Text size="sm" c="dimmed">
          No benchmark has a value for every pinned model — these models were never measured on the
          same yardstick.
        </Text>
      ) : (
        <ScrollArea>
          <Table withTableBorder withColumnBorders style={{ minWidth: 500 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Benchmark</Table.Th>
                {rows.map((row) => (
                  <Table.Th key={row.model_id}>
                    <Group gap={4} wrap="nowrap" justify="space-between">
                      <Text size="xs" fw={500}>
                        {row.display_name}
                      </Text>
                      <Button
                        variant="subtle"
                        color="gray"
                        size="compact-xs"
                        onClick={() => onUnpin(row.model_id)}
                      >
                        ✕
                      </Button>
                    </Group>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sharedColumns.map((col) => (
                <Table.Tr key={col.key}>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {sourceLabel(col.source)} · {metricLabel(col.metric)}
                    </Text>
                  </Table.Td>
                  {rows.map((row) => (
                    <Table.Td key={row.model_id} ta="right">
                      {formatMetricValue(col.metric, row.metrics[col.key] as number)}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Paper>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

function BenchmarksPage() {
  const data: BenchmarkMatrixData = Route.useLoaderData();
  const [search, setSearch] = useState("");
  const [currentOnly, setCurrentOnly] = useState(true);
  const [iuOnly, setIuOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>("coverage");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  const currentIds = useMemo(() => new Set(data.currentIds), [data.currentIds]);
  const allColumns = useMemo(() => discoverColumns(data.rows), [data.rows]);

  const filteredRows = useMemo(
    () => filterRows(data.rows, { search, currentOnly, iuOnly, currentIds }),
    [data.rows, search, currentOnly, iuOnly, currentIds],
  );

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortField, sortDir),
    [filteredRows, sortField, sortDir],
  );

  // Unfiltered lookup so a pin survives its row leaving the current filter/search view.
  const allRowsById = useMemo(() => new Map(data.rows.map((r) => [r.model_id, r])), [data.rows]);
  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const pinnedRows = useMemo(
    () =>
      pinnedIds
        .map((id) => allRowsById.get(id))
        .filter((r): r is BenchmarkModelRow => r !== undefined),
    [pinnedIds, allRowsById],
  );

  function togglePin(modelId: string) {
    setPinnedIds((prev) => {
      if (prev.includes(modelId)) return prev.filter((id) => id !== modelId);
      if (prev.length >= MAX_PINNED) return prev;
      return [...prev, modelId];
    });
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  return (
    <Stack gap="xl" pt="md">
      <Title order={2}>Benchmarks</Title>
      <Text size="sm" c="dimmed">
        Every metric_snapshot value, one row per model, grouped by the source that measured it — so
        no single leaderboard gets trusted blind. Coverage under each column header is how many of
        the currently shown models actually have a value there.
      </Text>

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

      <ComparisonPanel
        rows={pinnedRows}
        allColumns={allColumns}
        onUnpin={togglePin}
        onClear={() => setPinnedIds([])}
      />

      <Text size="sm" c="dimmed">
        {sortedRows.length} model{sortedRows.length !== 1 ? "s" : ""} · {allColumns.length}{" "}
        benchmark column{allColumns.length !== 1 ? "s" : ""}
      </Text>

      <MatrixTable
        rows={sortedRows}
        columns={allColumns}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
        pinnedIds={pinnedIdSet}
        onTogglePin={togglePin}
      />
    </Stack>
  );
}
