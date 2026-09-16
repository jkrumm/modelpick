import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Anchor,
  Badge,
  Box,
  Divider,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconBolt,
  IconBrain,
  IconCode,
  IconMicrophone,
  IconPencil,
  IconSpeakerphone,
} from "@tabler/icons-react";
import { scoreModels, CATEGORY_WEIGHTS, CATEGORY_MIN_QUALITY } from "~/server/scoring/score";
import type { CategoryWeights } from "~/server/scoring/score";
import type { ModelMetrics } from "~/server/scoring/normalize";
import type { RecommendationCategory } from "~/db/schema";
import { VX } from "~/charts";
import type { DeciderData, ProbeInfo } from "./-server-fns";
import { getDeciderData } from "./-server-fns";

export const Route = createFileRoute("/")({
  loader: async () => getDeciderData(),
  component: DeciderPage,
});

const CATEGORY_MODALITY: Record<RecommendationCategory, "llm" | "tts" | "stt"> = {
  fast: "llm",
  coding: "llm",
  writing: "llm",
  orchestrator: "llm",
  tts: "tts",
  stt: "stt",
};

const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  fast: "Fast",
  coding: "Coding",
  writing: "Writing",
  orchestrator: "Orchestrator",
  tts: "TTS",
  stt: "STT",
};

function CategoryIcon({ category }: { category: RecommendationCategory }) {
  const size = 16;
  if (category === "fast") return <IconBolt size={size} />;
  if (category === "coding") return <IconCode size={size} />;
  if (category === "writing") return <IconPencil size={size} />;
  if (category === "orchestrator") return <IconBrain size={size} />;
  if (category === "tts") return <IconSpeakerphone size={size} />;
  return <IconMicrophone size={size} />;
}

// What each bar is actually made of. Spelled out because every one of them is a
// min-max rank inside the filtered field, not an absolute figure — the number
// moves when a filter changes even though nothing about the model did.
const BAR_HINTS = {
  Quality: "Rank on the general intelligence index (AA), among the models passing the filters.",
  Cost: "Rank on price, log-scaled and inverted — 100 = cheapest in this field, not free.",
  Speed:
    "Rank on responsiveness: 60% inverted time-to-first-token, 40% decode rate. Live TTFT beats the leaderboard's where we have measured it.",
} as const;

function ScoreBar({
  label,
  value,
  color,
}: {
  label: keyof typeof BAR_HINTS;
  value: number | null;
  color: string;
}) {
  const pct = Math.round((value ?? 0) * 100);
  const measured = value !== null;
  return (
    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
      <Tooltip label={BAR_HINTS[label]} multiline w={280} withArrow>
        <Text size="xs" c="dimmed" style={{ width: 52, flexShrink: 0, cursor: "help" }}>
          {label}
        </Text>
      </Tooltip>
      <Box style={{ flex: 1 }}>
        <Progress value={pct} color={color} size="sm" />
      </Box>
      <Text size="xs" c="dimmed" style={{ width: 28, textAlign: "right", flexShrink: 0 }}>
        {/* A null dimension is scored as 0 by scoreModels. Printing "0" would
            claim we measured it and it was worst; "—" says we never measured it. */}
        {measured ? pct : "—"}
      </Text>
    </Group>
  );
}

function getTopModels(
  modelMetrics: ModelMetrics[],
  probes: Record<string, ProbeInfo>,
  modelMap: Map<string, { modality: string }>,
  category: RecommendationCategory,
  weights: CategoryWeights,
  iuOnly: boolean,
  currentOnly: boolean,
  currentIds: Set<string>,
  residencyFilter: "all" | "eu" | "us",
) {
  const targetModality = CATEGORY_MODALITY[category];
  const minQuality = CATEGORY_MIN_QUALITY[category];
  const filtered = modelMetrics.filter((mm) => {
    const model = modelMap.get(mm.model_id);
    if (model?.modality !== targetModality) return false;
    if (currentOnly && !currentIds.has(mm.model_id)) return false;
    if ((mm.quality ?? 0) < minQuality) return false;
    if (iuOnly) {
      const p = probes[mm.model_id];
      if (p === undefined || !p.accessible) return false;
    }
    if (residencyFilter !== "all") {
      const p = probes[mm.model_id];
      if (p?.residency !== residencyFilter) return false;
    }
    return true;
  });
  return scoreModels(
    filtered,
    weights,
    category === "coding" ? "coding" : category === "writing" ? "writing" : "quality",
  );
}

function CategoryCard({
  category,
  data,
  iuOnly,
  currentOnly,
  residencyFilter,
}: {
  category: RecommendationCategory;
  data: DeciderData;
  iuOnly: boolean;
  currentOnly: boolean;
  residencyFilter: "all" | "eu" | "us";
}) {
  // Each category ranks with its own weight profile — a single shared slider would
  // make every card pick the same model (and mismatch the persisted rationale).
  const weights = CATEGORY_WEIGHTS[category];
  const modelMap = useMemo(() => new Map(data.models.map((m) => [m.id, m])), [data.models]);

  const modalityMap = useMemo(
    () => new Map(data.models.map((m) => [m.id, { modality: m.modality }])),
    [data.models],
  );

  const currentIds = useMemo(() => new Set(data.currentIds), [data.currentIds]);

  const topModels = useMemo(
    () =>
      getTopModels(
        data.modelMetrics,
        data.probes,
        modalityMap,
        category,
        weights,
        iuOnly,
        currentOnly,
        currentIds,
        residencyFilter,
      ),
    [
      data.modelMetrics,
      data.probes,
      modalityMap,
      category,
      weights,
      iuOnly,
      currentOnly,
      currentIds,
      residencyFilter,
    ],
  );

  const top = topModels[0];
  const runnerUps = topModels.slice(1, 3);
  const topModel = top !== undefined ? modelMap.get(top.model_id) : undefined;

  const dbRec = data.recommendations.find((r) => r.category === category);
  // Every bar and the fit number are min-max ranks *within this field*, so the
  // field size is part of the reading: "80 on cost" against 4 survivors and
  // against 40 are different claims.
  const fieldSize = topModels.length;
  const isPersistedPick = dbRec !== undefined && dbRec.model_id === top?.model_id;

  // Audio categories (tts/stt) have no leaderboard metrics, so getTopModels yields
  // nothing — fall back to the persisted recommendation, which is chosen by the
  // probe-based audio ranking in the recommender. (For LLM categories an empty
  // result means the filters excluded everything, so keep the empty message.)
  const isAudio = CATEGORY_MODALITY[category] !== "llm";
  const fallbackModel =
    isAudio && top === undefined && dbRec !== undefined ? modelMap.get(dbRec.model_id) : undefined;
  const shownId = top?.model_id ?? fallbackModel?.id;
  const shownProbe = shownId !== undefined ? data.probes[shownId] : undefined;

  return (
    <Paper p="md" withBorder style={{ height: "100%" }}>
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <CategoryIcon category={category} />
            <Text fw={600} size="sm">
              {CATEGORY_LABELS[category]}
            </Text>
          </Group>
          <Group gap={4}>
            {shownProbe?.residency === "eu" && (
              <Badge color="blue" size="xs" variant="light">
                EU
              </Badge>
            )}
            {shownProbe?.residency === "us" && (
              <Badge color="orange" size="xs" variant="light">
                US
              </Badge>
            )}
            {shownProbe?.accessible === true && (
              <Badge color="green" size="xs" variant="light">
                IU
              </Badge>
            )}
          </Group>
        </Group>

        {top !== undefined && topModel !== undefined ? (
          <>
            <Box>
              <Text fw={700} size="md" style={{ lineHeight: 1.2 }}>
                {topModel.display_name}
              </Text>
              <Text size="xs" c="dimmed">
                {topModel.provider}
              </Text>
            </Box>

            <Stack gap={4}>
              <ScoreBar label="Quality" value={top.quality} color={VX.series.quality} />
              <ScoreBar label="Cost" value={top.cost} color={VX.series.cost} />
              <ScoreBar label="Speed" value={top.speed} color={VX.series.speed} />
            </Stack>

            <Text size="xs" c="dimmed" style={{ fontStyle: "italic", lineHeight: 1.4 }}>
              Fit {(top.score * 100).toFixed(1)} of 100 · rank 1 of {fieldSize}
              {isPersistedPick && <> — today&apos;s persisted pick</>}
            </Text>

            {/* The persisted rationale describes the persisted pick. Rendering it
                under a different model — which happens the moment a filter changes
                the ranking — attributes reasoning to a model it was never written
                about, so it is gated on the ids matching. */}
            {isPersistedPick && dbRec?.rationale !== undefined && dbRec?.rationale !== null && (
              <Tooltip label={dbRec.rationale} multiline w={380} withArrow>
                <Text
                  size="xs"
                  c="dimmed"
                  lineClamp={2}
                  style={{ lineHeight: 1.5, cursor: "help" }}
                >
                  {dbRec.rationale}
                </Text>
              </Tooltip>
            )}

            {runnerUps.length > 0 && (
              <>
                <Divider />
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={500}>
                    Runners-up
                  </Text>
                  {runnerUps.map((runner, i) => {
                    const runnerModel = modelMap.get(runner.model_id);
                    return (
                      <Group key={runner.model_id} justify="space-between">
                        <Text size="xs">
                          {i + 2}. {runnerModel?.display_name ?? runner.model_id}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {(runner.score * 100).toFixed(0)}
                        </Text>
                      </Group>
                    );
                  })}
                </Stack>
              </>
            )}
          </>
        ) : fallbackModel !== undefined && dbRec !== undefined ? (
          <>
            <Box>
              <Text fw={700} size="md" style={{ lineHeight: 1.2 }}>
                {fallbackModel.display_name}
              </Text>
              <Text size="xs" c="dimmed">
                {fallbackModel.provider}
              </Text>
            </Box>

            {shownProbe?.latency_ms !== null && shownProbe?.latency_ms !== undefined && (
              <Text size="xs" c="dimmed">
                Probe latency {Math.round(shownProbe.latency_ms)}ms
              </Text>
            )}

            <Text size="xs" c="dimmed" style={{ fontStyle: "italic" }}>
              Default pick
            </Text>

            {dbRec.rationale !== null && dbRec.rationale !== undefined && (
              <Tooltip label={dbRec.rationale} multiline w={380} withArrow>
                <Text
                  size="xs"
                  c="dimmed"
                  lineClamp={2}
                  style={{ lineHeight: 1.5, cursor: "help" }}
                >
                  {dbRec.rationale}
                </Text>
              </Tooltip>
            )}
          </>
        ) : (
          <Text size="sm" c="dimmed">
            No eligible models with current filters
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

const CATEGORIES: RecommendationCategory[] = [
  "fast",
  "coding",
  "writing",
  "orchestrator",
  "tts",
  "stt",
];

function DeciderPage() {
  const data = Route.useLoaderData();
  const snapshotDate = data.recommendations[0]?.snapshot_date;

  const [iuOnly, setIuOnly] = useState(true);
  const [currentOnly, setCurrentOnly] = useState(true);
  const [residencyFilter, setResidencyFilter] = useState<"all" | "eu" | "us">("all");

  return (
    <Stack gap="xl" pt="md">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Box>
          <Title order={2}>Decider</Title>
          <Text size="xs" c="dimmed">
            The algorithm&apos;s answer, recomputed from the filters below. What actually runs is{" "}
            <Anchor component={Link} to="/stack" size="xs">
              Stack
            </Anchor>
            .{snapshotDate !== undefined && <> Snapshot {snapshotDate}.</>}
          </Text>
        </Box>
      </Group>

      <Paper p="md" withBorder>
        <Stack gap="md">
          <Group gap="xl" wrap="wrap">
            <Tooltip label="Only show models accessible via IU unified endpoint">
              <Switch
                label="IU-available only"
                checked={iuOnly}
                onChange={(e) => setIuOnly(e.currentTarget.checked)}
                size="sm"
              />
            </Tooltip>
            <Tooltip label="Hide dated pins and models no longer tracked on leaderboards">
              <Switch
                label="Current only"
                checked={currentOnly}
                onChange={(e) => setCurrentOnly(e.currentTarget.checked)}
                size="sm"
              />
            </Tooltip>
            <Box>
              <Text size="xs" c="dimmed" mb={4}>
                Residency
              </Text>
              <SegmentedControl
                value={residencyFilter}
                onChange={(v) => setResidencyFilter(v as "all" | "eu" | "us")}
                data={[
                  { label: "All", value: "all" },
                  { label: "EU", value: "eu" },
                  { label: "US", value: "us" },
                ]}
                size="xs"
              />
            </Box>
          </Group>
          <Text size="xs" c="dimmed">
            Bars rank <em>within the filtered field</em>, not absolutely. &ldquo;—&rdquo; = never
            measured.
          </Text>
        </Stack>
      </Paper>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {CATEGORIES.map((cat) => (
          <CategoryCard
            key={cat}
            category={cat}
            data={data}
            iuOnly={iuOnly}
            currentOnly={currentOnly}
            residencyFilter={residencyFilter}
          />
        ))}
      </SimpleGrid>

      {data.recommendations.length === 0 && (
        <Paper p="xl" withBorder ta="center">
          <Text c="dimmed" size="sm">
            No recommendation data yet. Run{" "}
            <Text component="span" ff="monospace" size="sm">
              bun run recommend
            </Text>{" "}
            to generate rankings.
          </Text>
        </Paper>
      )}
    </Stack>
  );
}
