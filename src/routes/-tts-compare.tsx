import { useMemo, useState } from "react";
import {
  Accordion,
  Badge,
  Box,
  Button,
  Group,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import type { CompareManifest, CompareSample } from "~/server/audio/compare";
import { PlayerProvider, TtsWorkbench } from "./-tts-workbench";

const PRESETS = ["chat", "briefing", "podcast"] as const;

const fmtMs = (v: number | null) =>
  v === null ? "—" : `${(v / 1000).toFixed(1)} s`;
const fmtUsd = (v: number | null) => (v === null ? "—" : `$${v.toFixed(3)}`);

/** Stable pseudo-shuffle so blind labels do not change between renders. */
function blindOrder(samples: CompareSample[]): CompareSample[] {
  const h = (s: string) =>
    [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return samples.toSorted((a, b) => h(a.id) - h(b.id));
}

function SampleTable({
  samples,
  blind,
  metrics,
}: {
  samples: CompareSample[];
  blind: boolean;
  metrics: boolean;
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const rows = blind ? blindOrder(samples) : samples;
  return (
    <Table striped highlightOnHover verticalSpacing="xs" fz="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>#</Table.Th>
          <Table.Th>Play</Table.Th>
          <Table.Th>Model</Table.Th>
          <Table.Th>Voice</Table.Th>
          {metrics && (
            <>
              {" "}
              <Table.Th>
                <Tooltip
                  label="ArtificialAnalysis speech-arena rank (Elo in brackets). External leaderboard position."
                  multiline
                  w={240}
                >
                  <span>AA rank</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip
                  label="Time until the finished file was returned."
                  multiline
                  w={240}
                >
                  <span>Latency</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip
                  label="Time to first audio byte; only streaming endpoints have one."
                  multiline
                  w={240}
                >
                  <span>First audio</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip
                  label="Duration of the generated audio."
                  multiline
                  w={240}
                >
                  <span>Length</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip
                  label="List price per minute of audio. Hover a value for the source."
                  multiline
                  w={240}
                >
                  <span>$/min</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip
                  label="Whether the endpoint can stream audio while it is generated."
                  multiline
                  w={240}
                >
                  <span>Streaming</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip
                  label="Round trip through speech-to-text: verbatim = the transcript matches the input; diff = hover for what differs."
                  multiline
                  w={240}
                >
                  <span>Transcript</span>
                </Tooltip>
              </Table.Th>
            </>
          )}
          {samples.some((s) => s.request) && <Table.Th>Request</Table.Th>}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((s, i) => {
          const hidden = blind && !revealed.has(s.id);
          return (
            <Table.Tr key={s.id}>
              <Table.Td>{String.fromCharCode(65 + i)}</Table.Td>
              <Table.Td>
                <audio
                  controls
                  preload="none"
                  src={`/api/tts-audio/${s.file}`}
                  style={{ height: 28 }}
                >
                  <track kind="captions" />
                </audio>
              </Table.Td>
              {hidden ? (
                <Table.Td
                  colSpan={
                    (metrics ? 9 : 2) + (samples.some((x) => x.request) ? 1 : 0)
                  }
                >
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => setRevealed(new Set(revealed).add(s.id))}
                  >
                    reveal
                  </Button>
                </Table.Td>
              ) : (
                <>
                  <Table.Td>
                    <Text size="xs" fw={600}>
                      {s.model}
                    </Text>
                    {s.mode !== "single" && (
                      <Badge size="xs" variant="light" ml={4}>
                        {s.mode === "multi" ? "multi-speaker" : "turns+concat"}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {s.voice}{" "}
                    <Text span c="dimmed">
                      ({s.gender})
                    </Text>
                  </Table.Td>
                  {metrics && (
                    <>
                      {" "}
                      <Table.Td>{s.aa_rank ?? "—"}</Table.Td>
                      <Table.Td>{fmtMs(s.latency_ms)}</Table.Td>
                      <Table.Td>{fmtMs(s.first_audio_ms)}</Table.Td>
                      <Table.Td>
                        {s.duration_s === null
                          ? "—"
                          : `${s.duration_s.toFixed(1)} s`}
                      </Table.Td>
                      <Table.Td title={s.cost_source}>
                        {s.cost_per_min === null ? "—" : fmtUsd(s.cost_per_min)}
                      </Table.Td>
                      <Table.Td>{s.streaming}</Table.Td>
                      <Table.Td title={s.diff}>
                        {s.verbatim === null ? (
                          "—"
                        ) : (
                          <Badge
                            size="xs"
                            color={s.verbatim ? "green" : "orange"}
                          >
                            {s.verbatim ? "verbatim" : "diff"}
                          </Badge>
                        )}
                      </Table.Td>
                    </>
                  )}
                  {s.request && (
                    <Table.Td maw={260}>
                      <details>
                        <summary style={{ cursor: "pointer" }}>
                          exact request
                        </summary>
                        <Text
                          size="xs"
                          ff="monospace"
                          style={{
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                          }}
                        >
                          {s.request}
                        </Text>
                      </details>
                    </Table.Td>
                  )}
                </>
              )}
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function CompareSection({
  title,
  note,
  samples,
  texts,
  textPrefix,
  metrics,
}: {
  title: string;
  note: string;
  samples: CompareSample[];
  texts: Record<string, string>;
  textPrefix: string;
  metrics: boolean;
}) {
  const [blind, setBlind] = useState(false);
  const byPreset = useMemo(
    () =>
      Object.fromEntries(
        PRESETS.map((p) => [p, samples.filter((s) => s.preset === p)]),
      ),
    [samples],
  );
  if (samples.length === 0) return null;
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={3}>{title}</Title>
        <Switch
          label="Blind mode"
          checked={blind}
          onChange={(e) => setBlind(e.currentTarget.checked)}
        />
      </Group>
      <Text c="dimmed" size="xs">
        {note}
      </Text>
      <Tabs defaultValue="chat" keepMounted={false}>
        <Tabs.List>
          {PRESETS.map((p) => (
            <Tabs.Tab key={p} value={p}>
              {p} ({byPreset[p]?.length ?? 0})
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {PRESETS.map((p) => (
          <Tabs.Panel key={p} value={p} pt="sm">
            <Box mb="xs">
              <Text
                size="xs"
                c="dimmed"
                fs="italic"
                style={{ whiteSpace: "pre-wrap" }}
              >
                {texts[`${textPrefix}${p}`]}
              </Text>
            </Box>
            <SampleTable
              samples={byPreset[p] ?? []}
              blind={blind}
              metrics={metrics}
            />
          </Tabs.Panel>
        ))}
      </Tabs>
    </Stack>
  );
}

export function TtsCompare({ manifest }: { manifest: CompareManifest }) {
  const cross = useMemo(
    () => manifest.samples.filter((s) => !s.set),
    [manifest],
  );
  const audition = useMemo(
    () => manifest.samples.filter((s) => s.set === "audition"),
    [manifest],
  );
  if (manifest.samples.length === 0) return null;
  return (
    <PlayerProvider>
      <Stack gap="xl">
        <Stack gap="xs">
          <Title order={3}>Listening workbench</Title>
          <TtsWorkbench manifest={manifest} />
        </Stack>
        <Accordion variant="contained" multiple>
          <Accordion.Item value="models">
            <Accordion.Control>
              Reference: settled decisions — model comparison
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="xs" c="dimmed" mb="sm">
                Decided: Gemini 3.8 — chat on flash-lite, briefings and podcasts
                on flash. Kept for re-checking against new models; blind mode
                hides model names. Generated {manifest.generated_at}.
              </Text>
              <CompareSection
                title="German comparison"
                note="Same text per preset across models. Latency = finished file; first audio = streamed endpoints only. $/min is list price; hover for the source."
                samples={cross}
                texts={manifest.texts}
                textPrefix=""
                metrics
              />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="voices">
            <Accordion.Control>
              Reference: settled decisions — Gemini voice audition
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="xs" c="dimmed" mb="sm">
                Decided: Charon (main/male host) and Erinome (female co-host).
              </Text>
              <CompareSection
                title="Gemini 3.8 voice audition"
                note="Same German material and style per voice through the real lane pipeline: chat = raw reply on flash-lite; briefing = 3.8 prep on flash; podcast = one multi-speaker request. Open 'exact request' per row."
                samples={audition}
                texts={manifest.texts}
                textPrefix="aud_"
                metrics={false}
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </PlayerProvider>
  );
}
