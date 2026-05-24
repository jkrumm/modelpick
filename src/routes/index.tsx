import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Divider,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconBolt, IconBrain, IconCode, IconMicrophone, IconSpeakerphone } from "@tabler/icons-react";
import { scoreModels, CATEGORY_WEIGHTS } from "~/server/scoring/score";
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
  orchestrator: "llm",
  tts: "tts",
  stt: "stt",
};

const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  fast: "Fast",
  coding: "Coding",
  orchestrator: "Orchestrator",
  tts: "TTS",
  stt: "STT",
};

function CategoryIcon({ category }: { category: RecommendationCategory }) {
  const size = 16;
  if (category === "fast") return <IconBolt size={size} />;
  if (category === "coding") return <IconCode size={size} />;
  if (category === "orchestrator") return <IconBrain size={size} />;
  if (category === "tts") return <IconSpeakerphone size={size} />;
  return <IconMicrophone size={size} />;
}

function ScoreBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" style={{ width: 52, flexShrink: 0 }}>
        {label}
      </Text>
      <Box style={{ flex: 1 }}>
        <Progress value={pct} color={color} size="sm" />
      </Box>
      <Text size="xs" c="dimmed" style={{ width: 28, textAlign: "right", flexShrink: 0 }}>
        {pct}
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
  residencyFilter: "all" | "eu" | "us",
) {
  const targetModality = CATEGORY_MODALITY[category];
  const filtered = modelMetrics.filter((mm) => {
    const model = modelMap.get(mm.model_id);
    if (model?.modality !== targetModality) return false;
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
  return scoreModels(filtered, weights);
}

function CategoryCard({
  category,
  data,
  weights,
  iuOnly,
  residencyFilter,
}: {
  category: RecommendationCategory;
  data: DeciderData;
  weights: CategoryWeights;
  iuOnly: boolean;
  residencyFilter: "all" | "eu" | "us";
}) {
  const modelMap = useMemo(
    () => new Map(data.models.map((m) => [m.id, m])),
    [data.models],
  );

  const modalityMap = useMemo(
    () => new Map(data.models.map((m) => [m.id, { modality: m.modality }])),
    [data.models],
  );

  const topModels = useMemo(
    () =>
      getTopModels(
        data.modelMetrics,
        data.probes,
        modalityMap,
        category,
        weights,
        iuOnly,
        residencyFilter,
      ),
    [data.modelMetrics, data.probes, modalityMap, category, weights, iuOnly, residencyFilter],
  );

  const top = topModels[0];
  const runnerUps = topModels.slice(1, 3);
  const topModel = top !== undefined ? modelMap.get(top.model_id) : undefined;
  const topProbe = top !== undefined ? data.probes[top.model_id] : undefined;

  const dbRec = data.recommendations.find((r) => r.category === category);

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
            {topProbe?.residency === "eu" && (
              <Badge color="blue" size="xs" variant="light">
                EU
              </Badge>
            )}
            {topProbe?.residency === "us" && (
              <Badge color="orange" size="xs" variant="light">
                US
              </Badge>
            )}
            {topProbe?.accessible === true && (
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
              Score: {(top.score * 100).toFixed(1)}
              {dbRec !== undefined && dbRec.model_id === top.model_id && (
                <> — default pick</>
              )}
            </Text>

            {dbRec?.rationale !== undefined && dbRec?.rationale !== null && (
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
                {dbRec.rationale}
              </Text>
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
        ) : (
          <Text size="sm" c="dimmed">
            No eligible models with current filters
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function WeightSliders({
  weights,
  onChange,
}: {
  weights: CategoryWeights;
  onChange: (w: CategoryWeights) => void;
}) {
  const total = weights.quality + weights.cost + weights.speed;
  const isDefault =
    Math.abs(weights.quality - 0.5) < 0.01 &&
    Math.abs(weights.cost - 0.3) < 0.01 &&
    Math.abs(weights.speed - 0.2) < 0.01;

  function update(key: keyof CategoryWeights, val: number) {
    onChange({ ...weights, [key]: val });
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          Weights
        </Text>
        {!isDefault && (
          <Text
            size="xs"
            c="blue"
            style={{ cursor: "pointer" }}
            onClick={() =>
              onChange({ quality: 0.5, cost: 0.3, speed: 0.2 })
            }
          >
            Reset
          </Text>
        )}
      </Group>
      <Group gap="md" grow>
        <Box>
          <Text size="xs" c="dimmed" mb={4}>
            Quality — {Math.round(weights.quality * 100)}%
          </Text>
          <Slider
            value={weights.quality}
            onChange={(v) => update("quality", v)}
            min={0}
            max={1}
            step={0.05}
            color={VX.series.quality}
            size="sm"
            label={null}
          />
        </Box>
        <Box>
          <Text size="xs" c="dimmed" mb={4}>
            Cost — {Math.round(weights.cost * 100)}%
          </Text>
          <Slider
            value={weights.cost}
            onChange={(v) => update("cost", v)}
            min={0}
            max={1}
            step={0.05}
            color={VX.series.cost}
            size="sm"
            label={null}
          />
        </Box>
        <Box>
          <Text size="xs" c="dimmed" mb={4}>
            Speed — {Math.round(weights.speed * 100)}%
          </Text>
          <Slider
            value={weights.speed}
            onChange={(v) => update("speed", v)}
            min={0}
            max={1}
            step={0.05}
            color={VX.series.speed}
            size="sm"
            label={null}
          />
        </Box>
      </Group>
      <Text size="xs" c="dimmed">
        Total: {Math.round(total * 100)}% (weights are independent — not normalized)
      </Text>
    </Stack>
  );
}

const CATEGORIES: RecommendationCategory[] = [
  "fast",
  "coding",
  "orchestrator",
  "tts",
  "stt",
];

function DeciderPage() {
  const data = Route.useLoaderData();
  const snapshotDate = data.recommendations[0]?.snapshot_date;

  const [weights, setWeights] = useState<CategoryWeights>(CATEGORY_WEIGHTS.orchestrator);
  const [iuOnly, setIuOnly] = useState(true);
  const [residencyFilter, setResidencyFilter] = useState<"all" | "eu" | "us">("all");

  return (
    <Stack gap="xl" pt="md">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Box>
          <Title order={2}>LLM Decider</Title>
          {snapshotDate !== undefined && (
            <Text size="xs" c="dimmed">
              Snapshot: {snapshotDate}
            </Text>
          )}
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
          <WeightSliders weights={weights} onChange={setWeights} />
        </Stack>
      </Paper>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {CATEGORIES.map((cat) => (
          <CategoryCard
            key={cat}
            category={cat}
            data={data}
            weights={weights}
            iuOnly={iuOnly}
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
