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
  IconMicrophone,
  IconLock,
  IconLockOpen,
  IconAlertCircle,
} from "@tabler/icons-react";
import {
  getSttPlaygroundData,
  runSttDemoFn,
  toggleDemoPublicFn,
  getAdminDemosFn,
  EU_STT_MODELS,
} from "./-audio-server-fns";
import type { Demo, Model } from "~/db/schema";

export const Route = createFileRoute("/stt")({
  loader: async () => getSttPlaygroundData(),
  component: SttPage,
});

function ResidencyBadge({ modelId }: { modelId: string }) {
  return EU_STT_MODELS.has(modelId) ? (
    <Badge size="xs" color="blue" variant="light">
      EU
    </Badge>
  ) : (
    <Badge size="xs" color="orange" variant="light">
      non-EU
    </Badge>
  );
}

/** Groups STT demos by the source audio they transcribed. */
function groupBySource(demos: Demo[]): Map<string, Demo[]> {
  const map = new Map<string, Demo[]>();
  for (const d of demos) {
    const key = d.audio_path ?? `text:${d.text_content.slice(0, 50)}`;
    const group = map.get(key) ?? [];
    group.push(d);
    map.set(key, group);
  }
  return map;
}

interface TranscriptionCardProps {
  demo: Demo;
  model: Model | undefined;
  adminKey: string | null;
  onTogglePublic: (id: number, isPublic: boolean) => Promise<void>;
}

function TranscriptionCard({
  demo,
  model,
  adminKey,
  onTogglePublic,
}: TranscriptionCardProps) {
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
          <Group gap="xs">
            <Text size="sm" fw={500}>
              {model?.display_name ?? demo.model_id}
            </Text>
            <ResidencyBadge modelId={demo.model_id} />
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
        <Text
          size="sm"
          style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
        >
          &ldquo;{demo.text_content}&rdquo;
        </Text>
      </Stack>
    </Card>
  );
}

interface AdminSttPanelProps {
  adminKey: string;
  models: Model[];
  ttsAudioDemos: Demo[];
  onGenerated: () => Promise<void>;
}

function AdminSttPanel({
  adminKey,
  models,
  ttsAudioDemos,
  onGenerated,
}: AdminSttPanelProps) {
  const [modelId, setModelId] = useState<string>(models[0]?.id ?? "");
  const [sourceDemoId, setSourceDemoId] = useState<string>(
    ttsAudioDemos[0]?.id.toString() ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  if (ttsAudioDemos.length === 0) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="sm" c="dimmed">
          No TTS audio demos available. Generate TTS demos first (TTS
          playground).
        </Text>
      </Paper>
    );
  }

  const handleRun = async () => {
    if (!modelId || !sourceDemoId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await runSttDemoFn({
        data: {
          modelId,
          sourceDemoId: parseInt(sourceDemoId, 10),
          adminKey,
        },
      });
      setResult(res.text);
      await onGenerated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Text fw={500} size="sm">
          Run STT Transcription
        </Text>
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red">
            {error}
          </Alert>
        )}
        {result && (
          <Alert color="green">
            <Text size="xs" fw={500}>
              Result:
            </Text>
            <Text size="xs">&ldquo;{result}&rdquo;</Text>
          </Alert>
        )}
        <Group align="flex-end" gap="sm">
          <Select
            label="STT Model"
            size="sm"
            data={models.map((m) => ({ value: m.id, label: m.display_name }))}
            value={modelId}
            onChange={(v) => setModelId(v ?? "")}
            style={{ flex: 1 }}
          />
          <Select
            label="Source Audio (TTS Demo)"
            size="sm"
            data={ttsAudioDemos.map((d) => ({
              value: d.id.toString(),
              label: `Demo ${d.id} – ${d.model_id} (${d.lang}${d.preset ? ` / ${d.preset}` : ""})`,
            }))}
            value={sourceDemoId}
            onChange={(v) => setSourceDemoId(v ?? "")}
            style={{ flex: 1 }}
          />
          <Button
            size="sm"
            onClick={handleRun}
            loading={loading}
            leftSection={<IconMicrophone size={14} />}
          >
            Transcribe
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function SttPage() {
  const {
    models,
    demos: initialDemos,
    ttsAudioDemos,
  } = Route.useLoaderData();
  const [demos, setDemos] = useState(initialDemos);
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [adminInput, setAdminInput] = useState("");

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
        data: { modality: "stt", adminKey },
      });
      setDemos(allDemos);
    } else {
      const data = await getSttPlaygroundData();
      setDemos(data.demos);
    }
  };

  const handleTogglePublic = async (id: number, isPublic: boolean) => {
    if (!adminKey) return;
    await toggleDemoPublicFn({ data: { id, isPublic, adminKey } });
    await refreshDemos();
  };

  const modelMap = new Map(models.map((m) => [m.id, m]));
  const demosBySource = groupBySource(demos);

  return (
    <Stack gap="md" pt="xl">
      <Group align="center" gap="sm">
        <Title order={2}>STT Playground</Title>
        <IconMicrophone size={20} />
      </Group>
      <Text c="dimmed" size="sm">
        Compare speech-to-text transcription models on the same audio. EU-hosted
        models (Azure Sweden Central) are highlighted in blue.
      </Text>

      {demos.length === 0 ? (
        <Paper withBorder p="xl" ta="center">
          <Stack gap="xs" align="center">
            <IconMicrophone size={32} opacity={0.4} />
            <Text c="dimmed">No transcription demos available.</Text>
            {adminKey ? (
              <Text size="sm" c="dimmed">
                Generate TTS demos first, then use the admin panel to run
                transcriptions.
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                Enter your admin key below to generate demos.
              </Text>
            )}
          </Stack>
        </Paper>
      ) : (
        <Stack gap="xl">
          {[...demosBySource.entries()].map(([sourceKey, groupDemos]) => {
            const firstDemo = groupDemos[0];
            return (
              <Box key={sourceKey}>
                <Stack gap="xs" mb="sm">
                  <Group gap="xs">
                    <Text fw={600} size="sm">
                      Source audio
                    </Text>
                    {firstDemo && (
                      <>
                        <Badge size="xs" color="gray" variant="outline">
                          {firstDemo.lang.toUpperCase()}
                        </Badge>
                        {firstDemo.preset && (
                          <Badge size="xs" color="gray" variant="outline">
                            {firstDemo.preset}
                          </Badge>
                        )}
                      </>
                    )}
                  </Group>
                  {firstDemo?.audio_path && (
                    <audio
                      controls
                      src={firstDemo.audio_path}
                      aria-label={`Source audio – ${firstDemo.lang} ${firstDemo.preset ?? ""}`}
                      style={{ height: 32, maxWidth: 420 }}
                    >
                      <track kind="captions" />
                    </audio>
                  )}
                </Stack>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                  {groupDemos.map((d) => (
                    <TranscriptionCard
                      key={d.id}
                      demo={d}
                      model={modelMap.get(d.model_id)}
                      adminKey={adminKey}
                      onTogglePublic={handleTogglePublic}
                    />
                  ))}
                </SimpleGrid>
              </Box>
            );
          })}
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
          <AdminSttPanel
            adminKey={adminKey}
            models={models}
            ttsAudioDemos={ttsAudioDemos}
            onGenerated={refreshDemos}
          />
        </Stack>
      ) : (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Admin: enter key to unlock transcription generation
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
