import { useMemo, useState } from "react";
import { Badge, Box, Button, Group, Stack, Switch, Table, Tabs, Text, Title } from "@mantine/core";
import type { CompareManifest, CompareSample } from "~/server/audio/compare";

const PRESETS = ["chat", "briefing", "podcast"] as const;

const fmtMs = (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(1)} s`);
const fmtUsd = (v: number | null) => (v === null ? "—" : `$${v.toFixed(3)}`);

/** Stable pseudo-shuffle so blind labels do not change between renders. */
function blindOrder(samples: CompareSample[]): CompareSample[] {
  const h = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return samples.toSorted((a, b) => h(a.id) - h(b.id));
}

function SampleTable({ samples, blind }: { samples: CompareSample[]; blind: boolean }) {
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
          <Table.Th>AA rank</Table.Th>
          <Table.Th>Latency</Table.Th>
          <Table.Th>First audio</Table.Th>
          <Table.Th>Length</Table.Th>
          <Table.Th>$/min</Table.Th>
          <Table.Th>Streaming</Table.Th>
          <Table.Th>Transcript</Table.Th>
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
                <audio controls preload="none" src={`/api/tts-audio/${s.file}`} style={{ height: 28 }}>
                  <track kind="captions" />
                </audio>
              </Table.Td>
              {hidden ? (
                <Table.Td colSpan={samples.some((x) => x.request) ? 10 : 9}>
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
                    {s.voice} <Text span c="dimmed">({s.gender})</Text>
                  </Table.Td>
                  <Table.Td>{s.aa_rank ?? "—"}</Table.Td>
                  <Table.Td>{fmtMs(s.latency_ms)}</Table.Td>
                  <Table.Td>{fmtMs(s.first_audio_ms)}</Table.Td>
                  <Table.Td>{s.duration_s === null ? "—" : `${s.duration_s.toFixed(1)} s`}</Table.Td>
                  <Table.Td title={s.cost_source}>
                    {s.cost_per_min === null ? "—" : fmtUsd(s.cost_per_min)}
                  </Table.Td>
                  <Table.Td>{s.streaming}</Table.Td>
                  <Table.Td title={s.diff}>
                    {s.verbatim === null ? (
                      "—"
                    ) : (
                      <Badge size="xs" color={s.verbatim ? "green" : "orange"}>
                        {s.verbatim ? "verbatim" : "diff"}
                      </Badge>
                    )}
                  </Table.Td>
                  {s.request && (
                    <Table.Td maw={260}>
                      <details>
                        <summary style={{ cursor: "pointer" }}>exact request</summary>
                        <Text size="xs" ff="monospace" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
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
}: {
  title: string;
  note: string;
  samples: CompareSample[];
  texts: Record<string, string>;
  textPrefix: string;
}) {
  const [blind, setBlind] = useState(false);
  const byPreset = useMemo(
    () => Object.fromEntries(PRESETS.map((p) => [p, samples.filter((s) => s.preset === p)])),
    [samples],
  );
  if (samples.length === 0) return null;
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={3}>{title}</Title>
        <Switch label="Blind mode" checked={blind} onChange={(e) => setBlind(e.currentTarget.checked)} />
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
              <Text size="xs" c="dimmed" fs="italic" style={{ whiteSpace: "pre-wrap" }}>
                {texts[`${textPrefix}${p}`]}
              </Text>
            </Box>
            <SampleTable samples={byPreset[p] ?? []} blind={blind} />
          </Tabs.Panel>
        ))}
      </Tabs>
    </Stack>
  );
}

export function TtsCompare({ manifest }: { manifest: CompareManifest }) {
  const cross = useMemo(() => manifest.samples.filter((s) => !s.set), [manifest]);
  const audition = useMemo(() => manifest.samples.filter((s) => s.set === "audition"), [manifest]);
  const wave5 = useMemo(() => manifest.samples.filter((s) => s.set === "wave5"), [manifest]);
  if (manifest.samples.length === 0) return null;
  return (
    <Stack gap="xl">
      <CompareSection
        title="German comparison"
        note={`Same text per preset across models. Latency = finished file; first audio = streamed endpoints only. $/min is list price; hover for the source. Generated ${manifest.generated_at}.`}
        samples={cross}
        texts={manifest.texts}
        textPrefix=""
      />
      <CompareSection
        title="Gemini 3.8 voice audition"
        note="Same German material and same style/tags per voice through the real lane pipeline: chat = raw reply on flash-lite (prep off); briefing = prototype 3.8 prep (spoken numbers, 2 chunks, one short style, point tags) on flash; podcast = one multi-speaker request with per-turn style and tags (male alternatives pair with Sulafat, female candidates with Charon). Open 'exact request' per row. Transcript badge: orange 'diff' on chat is digit/Uhr normalisation, not misreading."
        samples={audition}
        texts={manifest.texts}
        textPrefix="aud_"
      />
      <CompareSection
        title="Gemini 3.8 quality experiments (Wave 5)"
        note="Chunk length (w5__chunks__*: same material at 1,000 / 1,500 / 2,000 / 3,000 chars per request), English terms in German speech (w5__english__*: plain / style hint / writer rule / both) and number handling (w5__numbers__*: normalised digits / spelled out / slow / rounded). Briefing tab = single speaker, podcast tab = two hosts. Measurements: docs/gemini-tts.md §Limits and chunking. Open 'exact request' per row."
        samples={wave5}
        texts={manifest.texts}
        textPrefix="w5_"
      />
    </Stack>
  );
}
