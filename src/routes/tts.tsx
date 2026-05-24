import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Title,
  Text,
  Stack,
  Badge,
  Group,
  Paper,
  Card,
  SegmentedControl,
  Button,
  Select,
  SimpleGrid,
  TextInput,
  ActionIcon,
  Alert,
  Box,
  Divider,
} from "@mantine/core";
import {
  IconSpeakerphone,
  IconLock,
  IconLockOpen,
  IconAlertCircle,
} from "@tabler/icons-react";
import {
  getTtsPlaygroundData,
  generateTtsDemoFn,
  toggleDemoPublicFn,
  getAdminDemosFn,
  TTS_PRESETS,
  EU_TTS_MODELS,
} from "./-audio-server-fns";
import type { Demo, Model } from "~/db/schema";

export const Route = createFileRoute("/tts")({
  loader: async () => getTtsPlaygroundData(),
  component: TtsPage,
});

function ResidencyBadge({ modelId }: { modelId: string }) {
  return EU_TTS_MODELS.has(modelId) ? (
    <Badge size="xs" color="blue" variant="light">
      EU
    </Badge>
  ) : (
    <Badge size="xs" color="orange" variant="light">
      non-EU
    </Badge>
  );
}

function groupByModel(demos: Demo[]): Map<string, Demo[]> {
  const map = new Map<string, Demo[]>();
  for (const d of demos) {
    const group = map.get(d.model_id) ?? [];
    group.push(d);
    map.set(d.model_id, group);
  }
  return map;
}

interface DemoCardProps {
  demo: Demo;
  model: Model | undefined;
  adminKey: string | null;
  onTogglePublic: (id: number, isPublic: boolean) => Promise<void>;
}

function DemoCard({ demo, model, adminKey, onTogglePublic }: DemoCardProps) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onTogglePublic(demo.id, !demo.public);
    } finally {
      setToggling(false);
    }
  };

  return (
    <Card withBorder padding="sm" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="wrap">
            <Text size="sm" fw={500}>
              {model?.display_name ?? demo.model_id}
            </Text>
            <ResidencyBadge modelId={demo.model_id} />
            <Badge size="xs" color="gray" variant="outline">
              {demo.lang.toUpperCase()}
            </Badge>
            {demo.preset && (
              <Badge size="xs" color="gray" variant="outline">
                {demo.preset}
              </Badge>
            )}
          </Group>
          {adminKey && (
            <ActionIcon
              size="sm"
              variant="subtle"
              loading={toggling}
              onClick={handleToggle}
              title={demo.public ? "Make private" : "Make public"}
            >
              {demo.public ? (
                <IconLockOpen size={14} />
              ) : (
                <IconLock size={14} />
              )}
            </ActionIcon>
          )}
        </Group>
        {demo.audio_path ? (
          <audio
            controls
            src={demo.audio_path}
            aria-label={`${model?.display_name ?? demo.model_id} – ${demo.lang} ${demo.preset ?? ""}`}
            style={{ width: "100%", height: 32 }}
          >
            <track kind="captions" />
          </audio>
        ) : (
          <Text size="xs" c="dimmed">
            Audio not available
          </Text>
        )}
        <Text size="xs" c="dimmed" lineClamp={2}>
          {demo.text_content}
        </Text>
      </Stack>
    </Card>
  );
}

interface AdminPanelProps {
  adminKey: string;
  models: Model[];
  onGenerated: () => Promise<void>;
}

function AdminGeneratePanel({ adminKey, models, onGenerated }: AdminPanelProps) {
  const [modelId, setModelId] = useState<string>(models[0]?.id ?? "");
  const [presetId, setPresetId] = useState<string>(TTS_PRESETS[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = TTS_PRESETS.find((p) => p.id === presetId) ?? TTS_PRESETS[0];

  const handleGenerate = async () => {
    if (!modelId || !preset) return;
    setLoading(true);
    setError(null);
    try {
      await generateTtsDemoFn({
        data: {
          modelId,
          text: preset.text,
          lang: preset.lang,
          preset: preset.preset,
          adminKey,
        },
      });
      await onGenerated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Text fw={500} size="sm">
          Generate TTS Demo
        </Text>
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red">
            {error}
          </Alert>
        )}
        <Group align="flex-end" gap="sm">
          <Select
            label="Model"
            size="sm"
            data={models.map((m) => ({ value: m.id, label: m.display_name }))}
            value={modelId}
            onChange={(v) => setModelId(v ?? "")}
            style={{ flex: 1 }}
          />
          <Select
            label="Preset"
            size="sm"
            data={TTS_PRESETS.map((p) => ({
              value: p.id,
              label: `${p.lang.toUpperCase()} – ${p.preset}`,
            }))}
            value={presetId}
            onChange={(v) => setPresetId(v ?? "")}
            style={{ flex: 1 }}
          />
          <Button
            size="sm"
            onClick={handleGenerate}
            loading={loading}
            leftSection={<IconSpeakerphone size={14} />}
          >
            Generate
          </Button>
        </Group>
        {preset && (
          <Text size="xs" c="dimmed">
            &ldquo;{preset.text}&rdquo;
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function TtsPage() {
  const { models, demos: initialDemos } = Route.useLoaderData();
  const [demos, setDemos] = useState(initialDemos);
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [adminInput, setAdminInput] = useState("");
  const [langFilter, setLangFilter] = useState<"all" | "en" | "de">("all");
  const [presetFilter, setPresetFilter] = useState<
    "all" | "standard" | "expressive"
  >("all");

  useEffect(() => {
    const key = localStorage.getItem("adminKey");
    if (key) setAdminKey(key);
  }, []);

  const handleAdminKeySubmit = () => {
    if (adminInput) {
      localStorage.setItem("adminKey", adminInput);
      setAdminKey(adminInput);
      setAdminInput("");
    }
  };

  const handleClearAdminKey = () => {
    localStorage.removeItem("adminKey");
    setAdminKey(null);
  };

  const refreshDemos = async () => {
    if (adminKey) {
      const allDemos = await getAdminDemosFn({
        data: { modality: "tts", adminKey },
      });
      setDemos(allDemos);
    } else {
      const data = await getTtsPlaygroundData();
      setDemos(data.demos);
    }
  };

  const handleTogglePublic = async (id: number, isPublic: boolean) => {
    if (!adminKey) return;
    await toggleDemoPublicFn({ data: { id, isPublic, adminKey } });
    await refreshDemos();
  };

  const modelMap = new Map(models.map((m) => [m.id, m]));

  const filteredDemos = demos.filter((d) => {
    if (langFilter !== "all" && d.lang !== langFilter) return false;
    if (presetFilter !== "all" && d.preset !== presetFilter) return false;
    return true;
  });

  const demosByModel = groupByModel(filteredDemos);

  return (
    <Stack gap="md" pt="xl">
      <Group align="center" gap="sm">
        <Title order={2}>TTS Playground</Title>
        <IconSpeakerphone size={20} />
      </Group>
      <Text c="dimmed" size="sm">
        Compare text-to-speech models on German and English presets. EU-hosted
        models (Azure Sweden Central) are highlighted in blue.
      </Text>

      <Group gap="md">
        <Box>
          <Text size="xs" c="dimmed" mb={4}>
            Language
          </Text>
          <SegmentedControl
            size="xs"
            data={[
              { label: "All", value: "all" },
              { label: "EN", value: "en" },
              { label: "DE", value: "de" },
            ]}
            value={langFilter}
            onChange={(v) => setLangFilter(v as "all" | "en" | "de")}
          />
        </Box>
        <Box>
          <Text size="xs" c="dimmed" mb={4}>
            Preset
          </Text>
          <SegmentedControl
            size="xs"
            data={[
              { label: "All", value: "all" },
              { label: "Standard", value: "standard" },
              { label: "Expressive", value: "expressive" },
            ]}
            value={presetFilter}
            onChange={(v) =>
              setPresetFilter(v as "all" | "standard" | "expressive")
            }
          />
        </Box>
      </Group>

      {filteredDemos.length === 0 ? (
        <Paper withBorder p="xl" ta="center">
          <Stack gap="xs" align="center">
            <IconSpeakerphone size={32} opacity={0.4} />
            <Text c="dimmed">No demos available.</Text>
            {adminKey && (
              <Text size="sm" c="dimmed">
                Use the admin panel below to generate demos.
              </Text>
            )}
          </Stack>
        </Paper>
      ) : (
        <Stack gap="xl">
          {[...demosByModel.entries()].map(([modelId, modelDemos]) => (
            <Box key={modelId}>
              <Group gap="xs" mb="sm">
                <Text fw={600}>
                  {modelMap.get(modelId)?.display_name ?? modelId}
                </Text>
                <ResidencyBadge modelId={modelId} />
                <Badge size="xs" color="gray" variant="outline">
                  {modelDemos.length} demo{modelDemos.length !== 1 ? "s" : ""}
                </Badge>
                {adminKey && (
                  <Badge
                    size="xs"
                    color={
                      modelDemos.every((d) => d.public) ? "green" : "orange"
                    }
                    variant="light"
                  >
                    {modelDemos.filter((d) => d.public).length}/
                    {modelDemos.length} public
                  </Badge>
                )}
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                {modelDemos.map((d) => (
                  <DemoCard
                    key={d.id}
                    demo={d}
                    model={modelMap.get(d.model_id)}
                    adminKey={adminKey}
                    onTogglePublic={handleTogglePublic}
                  />
                ))}
              </SimpleGrid>
            </Box>
          ))}
        </Stack>
      )}

      <Divider />

      {adminKey ? (
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={500} size="sm">
              Admin Mode
            </Text>
            <Button
              size="xs"
              variant="subtle"
              color="red"
              onClick={handleClearAdminKey}
            >
              Clear Key
            </Button>
          </Group>
          <AdminGeneratePanel
            adminKey={adminKey}
            models={models}
            onGenerated={refreshDemos}
          />
        </Stack>
      ) : (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Admin: enter key to unlock demo generation
            </Text>
            <Group>
              <TextInput
                size="sm"
                type="password"
                placeholder="Admin key"
                value={adminInput}
                onChange={(e) => setAdminInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdminKeySubmit();
                }}
                style={{ flex: 1 }}
              />
              <Button size="sm" onClick={handleAdminKeySubmit}>
                Unlock
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
