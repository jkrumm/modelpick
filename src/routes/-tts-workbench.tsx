import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import type {
  CompareManifest,
  CompareSample,
  WriterCell,
} from "~/server/audio/compare";
import { resolveExperiments } from "~/server/audio/experiments";
import type {
  ExperimentView,
  ExperimentVariant,
} from "~/server/audio/experiments";

const PICKS_KEY = "tts-picks-v1";

// ── one global player ──────────────────────────────────────────────────────

interface PlayerApi {
  playingId: string | null;
  toggle: (args: { id: string; file: string }) => void;
  pause: () => void;
  resume: () => void;
  focusRow: (cell: FocusedRow | null) => void;
}

interface FocusedRow {
  samples: (CompareSample | undefined)[];
}

const PlayerContext = createContext<PlayerApi | null>(null);

function usePlayer(): PlayerApi {
  const api = useContext(PlayerContext);
  if (!api) throw new Error("usePlayer outside PlayerProvider");
  return api;
}

/** Owns the single <audio> element. Native players elsewhere on the page are stopped when this one plays. */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const focusedRef = useRef<FocusedRow | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const currentRef = useRef<{ id: string; file: string } | null>(null);

  const toggle = useCallback(({ id, file }: { id: string; file: string }) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentRef.current?.id === id && !audio.paused) {
      audio.pause();
      return;
    }
    if (currentRef.current?.id !== id) {
      currentRef.current = { id, file };
      audio.src = `/api/tts-audio/${file}`;
    }
    void audio.play();
  }, []);

  const pause = useCallback(() => audioRef.current?.pause(), []);
  const resume = useCallback(() => {
    if (currentRef.current) void audioRef.current?.play();
  }, []);
  const focusRow = useCallback((row: FocusedRow | null) => {
    focusedRef.current = row;
  }, []);

  // Any other <audio> starting (reference tables use native controls) stops ours, and vice versa.
  useEffect(() => {
    const onPlay = (e: Event) => {
      const mine = audioRef.current;
      if (!(e.target instanceof HTMLAudioElement)) return;
      for (const el of document.querySelectorAll("audio")) {
        if (el !== e.target) el.pause();
      }
      setPlayingId(e.target === mine ? (currentRef.current?.id ?? null) : null);
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const audio = audioRef.current;
      if (e.key === " ") {
        if (!audio || !currentRef.current) return;
        e.preventDefault();
        if (audio.paused) void audio.play();
        else audio.pause();
        return;
      }
      if (!/^[1-7]$/.test(e.key)) return;
      const sample = focusedRef.current?.samples[Number(e.key) - 1];
      if (!sample) return;
      e.preventDefault();
      toggle({ id: sample.id, file: sample.file });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <PlayerContext.Provider
      value={{ playingId, toggle, pause, resume, focusRow }}
    >
      <audio
        ref={audioRef}
        preload="none"
        onPause={() => setPlayingId(null)}
        onEnded={() => setPlayingId(null)}
      >
        <track kind="captions" />
      </audio>
      {children}
    </PlayerContext.Provider>
  );
}

// ── picks (localStorage) ───────────────────────────────────────────────────

const pickListeners = new Set<() => void>();

function subscribePicks(listener: () => void): () => void {
  pickListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    pickListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const readPicksRaw = () => localStorage.getItem(PICKS_KEY) ?? "{}";

function parsePicks(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function usePicks(): [
  Record<string, string>,
  (args: { experimentId: string; variantKey: string }) => void,
] {
  // A string snapshot keeps useSyncExternalStore stable; server render sees no picks.
  const raw = useSyncExternalStore(subscribePicks, readPicksRaw, () => "{}");
  const setPick = useCallback(
    ({
      experimentId,
      variantKey,
    }: {
      experimentId: string;
      variantKey: string;
    }) => {
      const next = parsePicks(readPicksRaw());
      if (next[experimentId] === variantKey) delete next[experimentId];
      else next[experimentId] = variantKey;
      localStorage.setItem(PICKS_KEY, JSON.stringify(next));
      for (const listener of pickListeners) listener();
    },
    [],
  );
  return [parsePicks(raw), setPick];
}

// ── text with the differing words highlighted ──────────────────────────────

/** Word-level LCS against the baseline text; words not in the common subsequence are highlighted. */
function diffWords({
  text,
  baseline,
}: {
  text: string;
  baseline: string;
}): { word: string; changed: boolean }[] {
  const a = baseline.split(/\s+/);
  const b = text.split(/\s+/);
  const lcs = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: { word: string; changed: boolean }[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      out.push({ word: b[j]!, changed: false });
      i++;
      j++;
    } else if (i < a.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      i++;
    } else {
      out.push({ word: b[j]!, changed: true });
      j++;
    }
  }
  return out;
}

function SpokenTexts({ view }: { view: ExperimentView }) {
  const { texts, experiment } = view;
  if (texts.length === 0) return null;
  const baseline = texts[0]!.text;
  const letters = (keys: string[]) =>
    keys
      .map((k) => experiment.variants.find((v) => v.key === k)?.letter ?? k)
      .join(" · ");
  return (
    <Stack gap={6}>
      {texts.map((t, idx) => (
        <Group key={t.text} gap="xs" align="flex-start" wrap="nowrap">
          <Badge size="sm" variant="light" color="gray" miw={48}>
            {letters(t.variantKeys)}
          </Badge>
          <Text size="xs" style={{ lineHeight: 1.6 }}>
            {(idx === 0
              ? t.text.split(/\s+/).map((word) => ({ word, changed: false }))
              : diffWords({ text: t.text, baseline })
            ).map((w, i) =>
              w.changed ? (
                <Text
                  key={i}
                  span
                  size="xs"
                  fw={600}
                  bg="yellow.2"
                  c="dark.9"
                  px={2}
                >
                  {w.word}{" "}
                </Text>
              ) : (
                <span key={i}>{w.word} </span>
              ),
            )}
          </Text>
        </Group>
      ))}
      {texts.length > 1 && (
        <Text size="xs" c="dimmed">
          Highlighted words differ from the first text. Variants sharing a text
          differ only in the style hint
          {experiment.variants.some(
            (v) => v.key.includes("style") || v.key.includes("slow"),
          )
            ? " (see the variant description)"
            : ""}
          .
        </Text>
      )}
    </Stack>
  );
}

// ── cells and cards ────────────────────────────────────────────────────────

function PlayCell({
  sample,
  variant,
  picked,
  pickable,
  onPick,
  revealed,
}: {
  sample: CompareSample | undefined;
  variant: ExperimentVariant;
  picked: boolean;
  pickable: boolean;
  onPick: () => void;
  /** Blind cards pass false until revealed; for ordinary cards it is irrelevant (no `writer` data). */
  revealed: boolean;
}) {
  const player = usePlayer();
  const [showScript, setShowScript] = useState(false);
  if (!sample) {
    return (
      <Paper withBorder p="xs" radius="md" opacity={0.4}>
        <Text size="xs" c="dimmed" ta="center">
          not generated
        </Text>
      </Paper>
    );
  }
  const playing = player.playingId === sample.id;
  return (
    <Paper
      withBorder
      p="xs"
      radius="md"
      bd={picked ? "2px solid var(--mantine-color-green-6)" : undefined}
    >
      <Stack gap={6} align="center">
        <ActionIcon
          size={48}
          radius="xl"
          variant={playing ? "filled" : "light"}
          aria-label={`${playing ? "Pause" : "Play"} ${variant.letter}: ${variant.label}`}
          onClick={() => player.toggle({ id: sample.id, file: sample.file })}
        >
          {playing ? (
            <IconPlayerPauseFilled size={22} />
          ) : (
            <IconPlayerPlayFilled size={22} />
          )}
        </ActionIcon>
        <Text size="sm" fw={600} ta="center">
          {variant.letter} · {variant.label}
        </Text>
        <Group gap={6} justify="center">
          <Text size="xs" c="dimmed">
            {sample.duration_s === null
              ? "—"
              : `${sample.duration_s.toFixed(1)} s`}
          </Text>
          {variant.inProduction && (
            <Badge size="xs" color="blue" variant="light">
              in production
            </Badge>
          )}
        </Group>
        {sample.writer && revealed && <WriterReveal writer={sample.writer} />}
        {sample.writer && (
          <>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setShowScript((v) => !v)}
            >
              {showScript ? "hide script" : "script"}
            </Button>
            <Collapse expanded={showScript} w="100%">
              <Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {sample.writer.script}
              </Text>
            </Collapse>
          </>
        )}
        {pickable && (
          <Button
            size="compact-xs"
            variant={picked ? "filled" : "default"}
            color="green"
            leftSection={picked ? <IconCheck size={12} /> : null}
            onClick={onPick}
          >
            {picked ? "picked" : "pick"}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

function WriterReveal({ writer }: { writer: WriterCell }) {
  return (
    <Stack gap={2} align="center">
      <Text size="xs" fw={700}>
        {writer.model}
      </Text>
      <Text size="xs" c="dimmed" ta="center">
        ≈ ${writer.costUsdPerEpisode.toFixed(2)} / 20-min episode ·{" "}
        {writer.words}/{writer.targetWords} words · {writer.wallSeconds.toFixed(0)} s
        · ${writer.outputPricePerM}/M out
        {writer.tagViolations > 0 ? ` · ${writer.tagViolations} tag violations` : ""}
      </Text>
    </Stack>
  );
}

function ExperimentCard({
  view,
  pick,
  onPick,
}: {
  view: ExperimentView;
  pick: string | undefined;
  onPick: (variantKey: string) => void;
}) {
  const player = usePlayer();
  const { experiment } = view;
  const [revealed, setRevealed] = useState(!experiment.blind);
  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="sm">
        <div>
          <Group gap="xs">
            <Title order={4}>{experiment.title}</Title>
            <Badge
              size="xs"
              variant="light"
              color={experiment.kind === "check" ? "gray" : "grape"}
            >
              {experiment.kind === "check" ? "check — no pick" : "your call"}
            </Badge>
            {experiment.blind && (
              <Button
                size="compact-xs"
                variant={revealed ? "filled" : "light"}
                color="grape"
                onClick={() => setRevealed((v) => !v)}
              >
                {revealed ? "hide writers" : "reveal writers"}
              </Button>
            )}
          </Group>
          <Text size="sm">{experiment.question}</Text>
        </div>
        <Text size="xs" c="dimmed">
          <b>Same:</b> {experiment.same}. <b>Differs:</b> {experiment.differs}.
        </Text>
        <SpokenTexts view={view} />
        {experiment.variants.some((v) => v.description) && (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="xs">
            {experiment.variants.map((v) => (
              <Text key={v.key} size="xs" c="dimmed">
                <b>{v.letter}</b> {v.description}
              </Text>
            ))}
          </SimpleGrid>
        )}
        {view.rows.map(({ row, cells }) => (
          <Box
            key={row.key}
            tabIndex={0}
            onMouseEnter={() =>
              player.focusRow({
                samples: experiment.variants.map((v) => cells[v.key]),
              })
            }
            onFocus={() =>
              player.focusRow({
                samples: experiment.variants.map((v) => cells[v.key]),
              })
            }
            style={{ outline: "none" }}
          >
            <Text size="xs" fw={600} mb={4}>
              {row.label}
            </Text>
            <SimpleGrid cols={{ base: 2, md: 4 }} spacing="xs">
              {experiment.variants.map((v) => (
                <PlayCell
                  key={v.key}
                  sample={cells[v.key]}
                  variant={v}
                  picked={pick === v.key}
                  pickable={experiment.pickable}
                  onPick={() => onPick(v.key)}
                  revealed={revealed}
                />
              ))}
            </SimpleGrid>
          </Box>
        ))}
      </Stack>
    </Card>
  );
}

// ── summary ────────────────────────────────────────────────────────────────

function summaryLines({
  views,
  picks,
}: {
  views: ExperimentView[];
  picks: Record<string, string>;
}): string[] {
  return views
    .filter((v) => v.experiment.pickable)
    .map(({ experiment }) => {
      const variant = experiment.variants.find(
        (v) => v.key === picks[experiment.id],
      );
      return `${experiment.title}: ${variant ? `${variant.letter} — ${variant.label}` : "no pick yet"}`;
    });
}

function PicksSummary({
  views,
  picks,
}: {
  views: ExperimentView[];
  picks: Record<string, string>;
}) {
  const [copied, setCopied] = useState(false);
  const lines = summaryLines({ views, picks });
  const copy = async () => {
    await navigator.clipboard.writeText(
      `TTS picks\n${lines.map((l) => `- ${l}`).join("\n")}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={4}>Your picks</Title>
          {lines.map((l) => (
            <Text key={l} size="sm">
              {l}
            </Text>
          ))}
        </Stack>
        <Button
          size="xs"
          variant="light"
          leftSection={
            copied ? <IconCheck size={14} /> : <IconCopy size={14} />
          }
          onClick={() => void copy()}
        >
          {copied ? "copied" : "copy as text"}
        </Button>
      </Group>
    </Paper>
  );
}

export function TtsWorkbench({ manifest }: { manifest: CompareManifest }) {
  const views = resolveExperiments(manifest);
  const [picks, setPick] = usePicks();
  const questions = views.filter((v) => v.experiment.kind === "question");
  const checks = views.filter((v) => v.experiment.kind === "check");
  return (
    <Stack gap="lg">
      <PicksSummary views={views} picks={picks} />
      <Text size="xs" c="dimmed">
        Settled and not up for debate: Gemini 3.8 everywhere (chat on
        flash-lite, briefings and podcasts on flash), voices Charon and Erinome.
        Keys: hover a row, then <b>1–7</b> plays A–G, <b>space</b> pauses.
      </Text>
      {questions.map((view) => (
        <ExperimentCard
          key={view.experiment.id}
          view={view}
          pick={picks[view.experiment.id]}
          onPick={(variantKey) =>
            setPick({ experimentId: view.experiment.id, variantKey })
          }
        />
      ))}
      {checks.map((view) => (
        <ExperimentCard
          key={view.experiment.id}
          view={view}
          pick={undefined}
          onPick={() => undefined}
        />
      ))}
    </Stack>
  );
}
