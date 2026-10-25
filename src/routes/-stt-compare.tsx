import { useMemo, useState } from "react";
import { Accordion, Badge, Box, Code, Group, Select, Stack, Table, Text, Title } from "@mantine/core";
import type { SttClip, SttModelInfo, SttResult, SttResults, SttTestset } from "~/server/audio/stt-compare";
import { diffTokens, normalizeText, rawTokens, wer } from "~/server/audio/stt-score";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const usd = (v: number | null) => (v === null ? "—" : v === 0 ? "free" : `$${v.toFixed(4)}`);

/** Word-weighted WER over the clips of one kind (micro average), or null when nothing ran. */
function aggregate(rows: SttResult[], field: "wer_norm" | "wer_raw"): number | null {
  const ok = rows.filter((r) => r.ok && r[field] !== null);
  const words = ok.reduce((a, r) => a + r.ref_words, 0);
  if (!ok.length || !words) return null;
  return ok.reduce((a, r) => a + r[field]! * r.ref_words, 0) / words;
}

const median = (xs: number[]) => (xs.length ? xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);

function werColor(v: number | null): string | undefined {
  if (v === null) return undefined;
  if (v <= 0.05) return "teal";
  if (v <= 0.12) return "yellow";
  return "red";
}

function Summary({ models, results, clips }: { models: SttModelInfo[]; results: SttResult[]; clips: SttClip[] }) {
  const kind = new Map(clips.map((c) => [c.id, c.kind]));
  const ran = models.filter((m) => results.some((r) => r.model === m.model));
  const rows = ran.map((m) => {
    const mine = results.filter((r) => r.model === m.model);
    const of = (k: string) => mine.filter((r) => kind.get(r.clip) === k);
    const short = of("short");
    const failed = mine.filter((r) => !r.ok).length;
    const duo = of("duo")[0];
    return {
      m,
      short: aggregate(short, "wer_norm"),
      shortRaw: aggregate(short, "wer_raw"),
      noisy: aggregate(of("noisy"), "wer_norm"),
      long: aggregate(of("long"), "wer_norm"),
      longRaw: aggregate(of("long"), "wer_raw"),
      rtf: median(short.filter((r) => r.rtf !== null).map((r) => r.rtf!)),
      longRtf: of("long")[0]?.rtf ?? null,
      failed,
      total: mine.length,
      duo,
    };
  });
  const cell = (v: number | null) => (
    <Table.Td>
      <Text span size="xs" fw={600} {...(werColor(v) ? { c: werColor(v)! } : {})}>
        {pct(v)}
      </Text>
    </Table.Td>
  );
  return (
    <Table striped highlightOnHover verticalSpacing="xs" fz="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Model</Table.Th>
          <Table.Th>Where / residency</Table.Th>
          <Table.Th title="Normalised WER (lowercase, no punctuation), word-weighted over the 15 FLEURS clips">Short WER</Table.Th>
          <Table.Th title="Raw WER: casing and attached punctuation count as errors">Short raw</Table.Th>
          <Table.Th title="Same clips, band-limited to 8 kHz with pink noise">Noisy WER</Table.Th>
          <Table.Th title="12 min of Der Schimmelreiter, windowed against the Gutenberg text">Long WER</Table.Th>
          <Table.Th>Long raw</Table.Th>
          <Table.Th title="Wall time / audio duration, median over short clips. Local includes process start and model load.">RTF short</Table.Th>
          <Table.Th>RTF long</Table.Th>
          <Table.Th title="Share of words on the right speaker, two-host clip">Speakers</Table.Th>
          <Table.Th>$/min</Table.Th>
          <Table.Th>Failed</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map(({ m, short, shortRaw, noisy, long, longRaw, rtf, longRtf, failed, total, duo }) => (
          <Table.Tr key={m.model}>
            <Table.Td>
              <Text size="xs" fw={600}>
                {m.model}
              </Text>
            </Table.Td>
            <Table.Td>
              <Badge size="xs" variant="light" color={m.where === "local" ? "grape" : m.residency.startsWith("EU") ? "blue" : "orange"}>
                {m.where === "local" ? "local" : m.residency.split(" ")[0]}
              </Badge>{" "}
              <Text span c="dimmed" size="xs">
                {m.residency}
              </Text>
            </Table.Td>
            {cell(short)}
            {cell(shortRaw)}
            {cell(noisy)}
            {cell(long)}
            {cell(longRaw)}
            <Table.Td>{rtf === null ? "—" : rtf.toFixed(2)}</Table.Td>
            <Table.Td>{longRtf === null ? "—" : longRtf.toFixed(2)}</Table.Td>
            <Table.Td title={m.diarization}>
              {duo?.speaker_acc !== null && duo?.speaker_acc !== undefined ? `${pct(duo.speaker_acc)} · ${duo.speakers_detected} spk` : m.diarization.startsWith("yes") ? "n/a" : "no"}
            </Table.Td>
            <Table.Td title={m.cost_source}>{usd(m.per_min)}</Table.Td>
            <Table.Td>{failed ? <Text span c="red" size="xs">{failed}/{total}</Text> : "0"}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function DiffView({ clip, result }: { clip: SttClip; result: SttResult }) {
  const ops = useMemo(() => {
    const ref = rawTokens(clip.reference);
    const hyp = rawTokens(result.hypothesis);
    const w = wer(ref, hyp, clip.windowed === true);
    return diffTokens(ref.slice(w.refStart, w.refEnd), hyp);
  }, [clip, result]);
  return (
    <Box style={{ lineHeight: 1.9, fontSize: 13 }}>
      {ops.map((o, i) => {
        if (o.type === "eq") return <span key={i}>{o.ref} </span>;
        if (o.type === "sub") {
          // casing/punctuation-only differences are soft (yellow); a different word is hard (red)
          const soft = normalizeText(o.ref ?? "").join(" ") === normalizeText(o.hyp ?? "").join(" ");
          return (
            <span key={i} style={{ background: soft ? "var(--mantine-color-yellow-light)" : "var(--mantine-color-red-light)", borderRadius: 3 }} title={`ref: ${o.ref}`}>
              {o.hyp}{" "}
            </span>
          );
        }
        if (o.type === "ins") return <span key={i} style={{ background: "var(--mantine-color-orange-light)", borderRadius: 3 }} title="extra word">{o.hyp} </span>;
        return <span key={i} style={{ background: "var(--mantine-color-red-light)", textDecoration: "line-through", borderRadius: 3 }} title="missing from hypothesis">{o.ref} </span>;
      })}
    </Box>
  );
}

function ClipViewer({ testset, results }: { testset: SttTestset; results: SttResults }) {
  const [clipId, setClipId] = useState<string>(testset.clips[0]?.id ?? "");
  const [open, setOpen] = useState<string | null>(null);
  const clip = testset.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const rows = results.results.filter((r) => r.clip === clipId).toSorted((a, b) => (a.wer_norm ?? 9) - (b.wer_norm ?? 9));
  const shown = open ? rows.find((r) => r.model === open) : undefined;
  return (
    <Stack gap="xs">
      <Group align="end">
        <Select
          label="Clip"
          value={clipId}
          onChange={(v) => {
            setClipId(v ?? clipId);
            setOpen(null);
          }}
          data={testset.clips.map((c) => ({ value: c.id, label: `${c.kind} · ${c.id}` }))}
          w={360}
          allowDeselect={false}
        />
        <audio controls preload="none" src={`/api/stt-audio/${clip.file}`} style={{ height: 32 }}>
          <track kind="captions" />
        </audio>
      </Group>
      <Text size="xs" c="dimmed">
        {clip.source} · {clip.licence}
      </Text>
      <Text size="xs" fs="italic" {...(clip.windowed ? { lineClamp: 3 } : {})}>
        {clip.reference}
      </Text>
      <Table striped highlightOnHover verticalSpacing="xs" fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Model</Table.Th>
            <Table.Th>WER</Table.Th>
            <Table.Th>Raw WER</Table.Th>
            <Table.Th>Latency</Table.Th>
            <Table.Th>RTF</Table.Th>
            <Table.Th>Words ref/hyp</Table.Th>
            <Table.Th>Diff</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.model}>
              <Table.Td fw={600}>{r.model}</Table.Td>
              <Table.Td>{r.ok ? pct(r.wer_norm) : <Text span c="red" size="xs" title={r.error}>failed</Text>}</Table.Td>
              <Table.Td>{pct(r.wer_raw)}</Table.Td>
              <Table.Td>{r.latency_ms === null ? "—" : `${(r.latency_ms / 1000).toFixed(1)} s`}</Table.Td>
              <Table.Td>{r.rtf === null ? "—" : r.rtf.toFixed(2)}</Table.Td>
              <Table.Td>{r.ref_words}/{r.hyp_words}</Table.Td>
              <Table.Td>
                {r.ok && (
                  <Text span size="xs" c="blue" style={{ cursor: "pointer" }} onClick={() => setOpen(open === r.model ? null : r.model)}>
                    {open === r.model ? "hide" : "show"}
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {shown && (
        <Box>
          <Text size="xs" c="dimmed" mb={4}>
            {shown.model} vs reference — <span style={{ background: "var(--mantine-color-red-light)" }}>wrong/missing word</span>{" "}
            <span style={{ background: "var(--mantine-color-yellow-light)" }}>casing/punctuation only</span>{" "}
            <span style={{ background: "var(--mantine-color-orange-light)" }}>extra word</span>
          </Text>
          <DiffView clip={clip} result={shown} />
        </Box>
      )}
    </Stack>
  );
}

function HowTo({ models }: { models: SttModelInfo[] }) {
  return (
    <Accordion variant="separated" multiple>
      {models.map((m) => (
        <Accordion.Item key={m.model} value={m.model}>
          <Accordion.Control>
            <Text size="sm" fw={600}>
              {m.model}
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap={4}>
              <Text size="xs">{m.howto}</Text>
              <Text size="xs" c="dimmed">
                Residency: {m.residency} · Diarization: {m.diarization} · Timestamps: {m.word_timestamps}
              </Text>
              <Text size="xs" c="dimmed">
                Price: {m.per_min === null ? "—" : usd(m.per_min)}/min — {m.cost_source}
              </Text>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

export function SttCompare({ testset, results }: { testset: SttTestset; results: SttResults }) {
  if (!results.results.length) return null;
  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <Title order={3}>German comparison</Title>
        <Text c="dimmed" size="xs">
          Public German audio only (no personal recordings, per the residency rule): 15 FLEURS-de clips, 2 degraded phone-quality clips, 12 min of a LibriVox
          reading against the Gutenberg text (windowed), and a synthetic two-host clip for diarization. WER is word-level Levenshtein; the normalised
          column follows Open ASR (lowercase, no punctuation, digits as written), the raw column counts casing and attached punctuation. Colours: ≤5 % teal, ≤12 % yellow.
          Cloud latency is one request; local wall time includes MacWhisper process start. Generated {results.generated_at}; estimated IU spend ${results.spend_usd.toFixed(2)}.
        </Text>
        <Summary models={results.models} results={results.results} clips={testset.clips} />
      </Stack>
      <Stack gap="xs">
        <Title order={3}>Per-clip transcripts</Title>
        <ClipViewer testset={testset} results={results} />
      </Stack>
      <Stack gap="xs">
        <Title order={3}>How to call it</Title>
        <HowTo models={results.models.filter((m) => results.results.some((r) => r.model === m.model))} />
        <Text size="xs" c="dimmed">
          Rebuild the test set with <Code>bun scripts/stt-testset.ts</Code>, rerun with <Code>bun scripts/stt-compare.ts</Code> (see AGENTS.md).
        </Text>
      </Stack>
    </Stack>
  );
}
