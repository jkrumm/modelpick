import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  ActionIcon,
  Alert,
  Box,
  Divider,
  Code,
  Chip,
  Switch,
} from "@mantine/core";
import { IconSpeakerphone, IconLock, IconLockOpen, IconAlertCircle } from "@tabler/icons-react";
import {
  getTtsPlaygroundData,
  generateTtsDemoFn,
  toggleDemoPublicFn,
  toggleVoicePublicFn,
  getAdminDemosFn,
  TTS_PRESETS,
  TTS_CANDIDATE_VOICES,
  EU_TTS_MODELS,
} from "./-audio-server-fns";
import type { Demo, Model } from "~/db/schema";
import { useAdmin } from "~/admin/useAdmin";
import { GeminiTtsDocs } from "./-gemini-tts-docs";

export const Route = createFileRoute("/tts")({
  loader: async () => getTtsPlaygroundData(),
  component: TtsPage,
});

const VOICE_CHARACTER = new Map(TTS_CANDIDATE_VOICES.map((v) => [v.name, v.character]));

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

/** Renders demo text with inline expression tags ([pause], [chuckles], …)
 *  highlighted, so the performance cues are visible next to the audio. */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <Text size="xs" c="dimmed">
      {parts.map((part, i) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <Code key={i} c="grape" style={{ fontSize: 11 }}>
            {part}
          </Code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </Text>
  );
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

  const character = demo.voice ? VOICE_CHARACTER.get(demo.voice) : undefined;

  return (
    <Card withBorder padding="sm" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="wrap">
            {demo.voice && (
              <Badge size="xs" color="grape" variant="light">
                {demo.voice}
                {character ? ` · ${character}` : ""}
              </Badge>
            )}
            {demo.preset && (
              <Badge size="xs" color="gray" variant="outline">
                {demo.preset}
              </Badge>
            )}
            <Badge size="xs" color="gray" variant="outline">
              {demo.lang.toUpperCase()}
            </Badge>
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
              {demo.public ? <IconLockOpen size={14} /> : <IconLock size={14} />}
            </ActionIcon>
          )}
        </Group>
        <Text size="10px" c="dimmed">
          {model?.display_name ?? demo.model_id}
        </Text>
        {demo.audio_path ? (
          <audio
            controls
            src={demo.audio_path}
            aria-label={`${demo.voice ?? model?.display_name ?? demo.model_id} – ${demo.lang} ${demo.preset ?? ""}`}
            style={{ width: "100%", height: 32 }}
          >
            <track kind="captions" />
          </audio>
        ) : (
          <Text size="xs" c="dimmed">
            Audio not available
          </Text>
        )}
        <InlineText text={demo.text_content} />
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
  const [voice, setVoice] = useState<string>(TTS_CANDIDATE_VOICES[0]?.name ?? "");
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
          ...(voice ? { voice } : {}),
          ...(preset.style ? { style: preset.style } : {}),
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
          <Select
            label="Voice (Gemini)"
            size="sm"
            data={TTS_CANDIDATE_VOICES.map((v) => ({
              value: v.name,
              label: `${v.name} · ${v.character}`,
            }))}
            value={voice}
            onChange={(v) => setVoice(v ?? "")}
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
        {preset?.style && (
          <Text size="xs" c="dimmed" fs="italic">
            Direction: {preset.style}
          </Text>
        )}
        {preset && <InlineText text={preset.text} />}
      </Stack>
    </Paper>
  );
}

interface VoiceToggleBarProps {
  enabledVoices: Set<string>;
  pendingVoice: string | null;
  showDisabled: boolean;
  onToggleVoice: (voice: string, enable: boolean) => void;
  onShowDisabled: (show: boolean) => void;
}

/** Admin-only board to enable/disable candidate voices and narrow the shortlist. */
function VoiceToggleBar({
  enabledVoices,
  pendingVoice,
  showDisabled,
  onToggleVoice,
  onShowDisabled,
}: VoiceToggleBarProps) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={500} size="sm">
            Candidate voices ({enabledVoices.size}/{TTS_CANDIDATE_VOICES.length} enabled)
          </Text>
          <Switch
            size="xs"
            label="Show disabled"
            checked={showDisabled}
            onChange={(e) => onShowDisabled(e.currentTarget.checked)}
          />
        </Group>
        <Text size="xs" c="dimmed">
          Toggle a voice off to drop it from the shortlist — clips become private (hidden from
          visitors). Narrow down until only your pick remains.
        </Text>
        <Group gap="xs">
          {TTS_CANDIDATE_VOICES.map((v) => {
            const enabled = enabledVoices.has(v.name);
            return (
              <Chip
                key={v.name}
                checked={enabled}
                color="grape"
                size="sm"
                disabled={pendingVoice === v.name}
                onChange={() => onToggleVoice(v.name, !enabled)}
              >
                {v.name} · {v.character}
              </Chip>
            );
          })}
        </Group>
      </Stack>
    </Paper>
  );
}

type GroupBy = "voice" | "preset";

function groupKey(demo: Demo, by: GroupBy, modelMap: Map<string, Model>): string {
  if (by === "voice") {
    return demo.voice ?? modelMap.get(demo.model_id)?.display_name ?? demo.model_id;
  }
  return demo.preset ?? "—";
}

function groupLabel(key: string, by: GroupBy): string {
  if (by === "voice") {
    const character = VOICE_CHARACTER.get(key);
    return character ? `${key} · ${character}` : key;
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function TtsPage() {
  const { models, demos: initialDemos } = Route.useLoaderData();
  const [demos, setDemos] = useState(initialDemos);
  const { effectiveKey: adminKey } = useAdmin();
  const [langFilter, setLangFilter] = useState<"all" | "en" | "de">("all");
  const [presetFilter, setPresetFilter] = useState<string>("all");
  const [voiceFilter, setVoiceFilter] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("voice");
  const [showDisabled, setShowDisabled] = useState(false);
  const [pendingVoice, setPendingVoice] = useState<string | null>(null);

  const modelMap = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  // A voice is "enabled" (in the shortlist) when it has at least one public clip.
  const enabledVoices = useMemo(
    () => new Set(demos.filter((d) => d.public && d.voice).map((d) => d.voice as string)),
    [demos],
  );

  // Filter option lists are derived from whatever demos exist (open-ended presets/voices).
  const presetOptions = useMemo(() => {
    const present = new Set(demos.map((d) => d.preset).filter((p): p is string => Boolean(p)));
    return [
      { label: "All", value: "all" },
      ...[...present]
        .toSorted()
        .map((p) => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: p })),
    ];
  }, [demos]);

  const voiceOptions = useMemo(() => {
    const present = new Set(demos.map((d) => d.voice).filter((v): v is string => Boolean(v)));
    return [
      { label: "All voices", value: "all" },
      ...[...present].toSorted().map((v) => ({ label: v, value: v })),
    ];
  }, [demos]);

  const refreshDemos = async () => {
    if (adminKey) {
      const allDemos = await getAdminDemosFn({ data: { modality: "tts", adminKey } });
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

  const handleToggleVoice = async (voice: string, enable: boolean) => {
    if (!adminKey) return;
    setPendingVoice(voice);
    try {
      await toggleVoicePublicFn({ data: { modality: "tts", voice, isPublic: enable, adminKey } });
      await refreshDemos();
    } finally {
      setPendingVoice(null);
    }
  };

  // Non-admins only ever receive public clips. In admin mode the shortlist (public
  // clips) is shown by default; "Show disabled" reveals dropped voices for review.
  const visibleDemos =
    adminKey && !showDisabled ? demos.filter((d) => d.public || !d.voice) : demos;

  const filteredDemos = visibleDemos.filter((d) => {
    if (langFilter !== "all" && d.lang !== langFilter) return false;
    if (presetFilter !== "all" && d.preset !== presetFilter) return false;
    if (voiceFilter !== "all" && d.voice !== voiceFilter) return false;
    return true;
  });

  const grouped = useMemo(() => {
    const map = new Map<string, Demo[]>();
    for (const d of filteredDemos) {
      const key = groupKey(d, groupBy, modelMap);
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    return [...map.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  }, [filteredDemos, groupBy, modelMap]);

  return (
    <Stack gap="md" pt="xl">
      <Group align="center" gap="sm">
        <Title order={2}>TTS Playground</Title>
        <IconSpeakerphone size={20} />
      </Group>
      <Text c="dimmed" size="sm">
        Compare text-to-speech across two dimensions — <b>voice</b> (the speaker) and <b>preset</b>{" "}
        (what is said + delivery style, with inline expression tags). EU-hosted models are
        highlighted in blue.
      </Text>

      <GeminiTtsDocs />

      {adminKey && (
        <VoiceToggleBar
          enabledVoices={enabledVoices}
          pendingVoice={pendingVoice}
          showDisabled={showDisabled}
          onToggleVoice={handleToggleVoice}
          onShowDisabled={setShowDisabled}
        />
      )}

      <Group gap="md" align="flex-end">
        <Box>
          <Text size="xs" c="dimmed" mb={4}>
            Group by
          </Text>
          <SegmentedControl
            size="xs"
            data={[
              { label: "Speaker", value: "voice" },
              { label: "Preset", value: "preset" },
            ]}
            value={groupBy}
            onChange={(v) => setGroupBy(v as GroupBy)}
          />
        </Box>
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
            data={presetOptions}
            value={presetFilter}
            onChange={setPresetFilter}
          />
        </Box>
        <Select
          label="Voice"
          size="xs"
          data={voiceOptions}
          value={voiceFilter}
          onChange={(v) => setVoiceFilter(v ?? "all")}
          w={160}
        />
      </Group>

      {filteredDemos.length === 0 ? (
        <Paper withBorder p="xl" ta="center">
          <Stack gap="xs" align="center">
            <IconSpeakerphone size={32} opacity={0.4} />
            <Text c="dimmed">No demos match the current filters.</Text>
            {adminKey && (
              <Text size="sm" c="dimmed">
                Use the admin panel below to generate demos.
              </Text>
            )}
          </Stack>
        </Paper>
      ) : (
        <Stack gap="xl">
          {grouped.map(([key, groupDemos]) => {
            const isCandidate = groupBy === "voice" && VOICE_CHARACTER.has(key);
            const isDisabled = isCandidate && !enabledVoices.has(key);
            return (
              <Box key={key} style={isDisabled ? { opacity: 0.55 } : undefined}>
                <Group gap="xs" mb="sm">
                  <Text fw={600}>{groupLabel(key, groupBy)}</Text>
                  <Badge size="xs" color="gray" variant="outline">
                    {groupDemos.length} clip{groupDemos.length !== 1 ? "s" : ""}
                  </Badge>
                  {isDisabled && (
                    <Badge size="xs" color="red" variant="light">
                      disabled
                    </Badge>
                  )}
                  {adminKey && isCandidate && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color={isDisabled ? "grape" : "red"}
                      loading={pendingVoice === key}
                      onClick={() => handleToggleVoice(key, isDisabled)}
                    >
                      {isDisabled ? "Enable" : "Disable"}
                    </Button>
                  )}
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                  {groupDemos.map((d) => (
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
            );
          })}
        </Stack>
      )}

      <Divider />

      {adminKey ? (
        <Stack gap="md">
          <Text fw={500} size="sm">
            Admin Mode
          </Text>
          <AdminGeneratePanel adminKey={adminKey} models={models} onGenerated={refreshDemos} />
        </Stack>
      ) : (
        <Paper withBorder p="md" radius="md">
          <Text size="sm" c="dimmed">
            Generating demos is admin-only.{" "}
            <Text component={Link} to="/admin" inherit c="blue">
              Enter admin mode
            </Text>{" "}
            to unlock it.
          </Text>
        </Paper>
      )}
    </Stack>
  );
}
