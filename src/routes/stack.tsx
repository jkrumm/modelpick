import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Accordion,
  Badge,
  Box,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconBolt,
  IconBrain,
  IconCode,
  IconEye,
  IconMicrophone,
  IconPencil,
  IconPhoto,
  IconSpeakerphone,
  IconVector,
} from "@tabler/icons-react";
import type { StackCategory, Thinking } from "~/db/schema";
import { getMyStack } from "./-stack-server-fns";
import type { DeploymentEntry, DeploymentFlag, StackEntry } from "./-stack-server-fns";

export const Route = createFileRoute("/stack")({
  loader: async () => getMyStack(),
  component: StackPage,
});

const CATEGORY_LABELS: Record<StackCategory, string> = {
  fast: "Fast",
  coding: "Coding",
  writing: "Writing",
  orchestrator: "Orchestrator",
  tts: "TTS",
  stt: "STT",
  embedding: "Embedding",
  vision: "Vision",
  image: "Image Gen",
};

// off is the one setting worth flagging at a glance — everything else is a
// shade of "the model is thinking", off is "it deliberately is not".
const THINKING_COLOR: Record<Thinking, string> = {
  off: "red",
  "n/a": "gray",
  default: "blue",
  minimal: "teal",
  low: "teal",
  medium: "teal",
  high: "teal",
  max: "teal",
};

const FLAG_COLOR: Record<DeploymentFlag, string> = {
  unresolvable: "red",
  inaccessible: "orange",
  drift: "yellow",
  stale: "gray",
};

// Drives the Needs attention severity sort — lower index is worse.
const FLAG_ORDER: DeploymentFlag[] = ["unresolvable", "inaccessible", "drift", "stale"];

function flagTooltip(flag: DeploymentFlag, entry: DeploymentEntry): string {
  if (flag === "unresolvable") return "No model with this id exists in the catalog.";
  if (flag === "inaccessible") return "Latest access probe failed for this model.";
  if (flag === "drift")
    return `Algorithm prefers ${entry.algo_display_name ?? "a different model"}`;
  return `config_ref last verified ${entry.verified_at ?? "never"} — re-check it.`;
}

function CategoryIcon({ category }: { category: StackCategory }) {
  const size = 16;
  if (category === "fast") return <IconBolt size={size} />;
  if (category === "coding") return <IconCode size={size} />;
  if (category === "writing") return <IconPencil size={size} />;
  if (category === "orchestrator") return <IconBrain size={size} />;
  if (category === "tts") return <IconSpeakerphone size={size} />;
  if (category === "stt") return <IconMicrophone size={size} />;
  if (category === "embedding") return <IconVector size={size} />;
  if (category === "vision") return <IconEye size={size} />;
  return <IconPhoto size={size} />; // image
}

function driftLabel(entry: StackEntry): string {
  const parts: string[] = [];
  if (entry.algo !== null && entry.algo.model_id !== entry.pick.model_id) {
    parts.push(`Algorithm prefers ${entry.algo.display_name}`);
  }
  if (entry.bench !== null) {
    const picks = [entry.bench.worker, entry.bench.interactive].filter(
      (p): p is NonNullable<typeof p> => p !== null,
    );
    if (!picks.some((p) => p.model_id === entry.pick.model_id))
      parts.push(`ccbench prefers ${picks.map((p) => p.display_name).join(" / ")}`);
  }
  return `${parts.join("; ")} — review your pick`;
}

function severityIndex(flags: DeploymentFlag[]): number {
  return Math.min(...flags.map((f) => FLAG_ORDER.indexOf(f)));
}

function firstSentence(text: string | null): string {
  if (text === null) return "—";
  const match = /^[^.!?]*[.!?]/.exec(text);
  return match !== null ? match[0].trim() : text;
}

function pickTooltip(entry: StackEntry): string | null {
  const parts = [entry.rationale, entry.env_note].filter((t): t is string => t !== null);
  return parts.length > 0 ? parts.join(" — ") : null;
}

function DeploymentFlagBadges({ entry }: { entry: DeploymentEntry }) {
  if (entry.flags.length === 0) {
    return (
      <Badge color="green" size="xs" variant="light">
        ok
      </Badge>
    );
  }
  return (
    <Group gap={4} wrap="wrap">
      {entry.flags.map((flag) => (
        <Tooltip key={flag} label={flagTooltip(flag, entry)} withArrow>
          <Badge color={FLAG_COLOR[flag]} size="xs" variant="light" style={{ cursor: "help" }}>
            {flag}
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );
}

function NeedsAttentionRow({ entry }: { entry: DeploymentEntry }) {
  return (
    <Table.Tr>
      <Table.Td>
        <Tooltip label={entry.label} withArrow>
          <Text ff="monospace" size="sm" style={{ cursor: "help" }}>
            {entry.service}/{entry.slot}
          </Text>
        </Tooltip>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{entry.display_name}</Text>
      </Table.Td>
      <Table.Td>
        <DeploymentFlagBadges entry={entry} />
      </Table.Td>
      <Table.Td>
        {entry.flags.includes("drift") ? (
          <Text size="xs">→ {entry.algo_display_name ?? "a different model"}</Text>
        ) : (
          <Text size="xs" lineClamp={2}>
            {firstSentence(entry.rationale)}
          </Text>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

// Row click toggles a colSpan detail panel — the fields below never occupy
// their own columns.
function AllSlotsRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: DeploymentEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <Table.Tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <Table.Td>{entry.service}</Table.Td>
        <Table.Td ff="monospace">{entry.slot}</Table.Td>
        <Table.Td>{entry.display_name}</Table.Td>
        <Table.Td>
          <Badge color={THINKING_COLOR[entry.thinking]} size="xs" variant="light">
            {entry.thinking}
          </Badge>
        </Table.Td>
        <Table.Td>
          <DeploymentFlagBadges entry={entry} />
        </Table.Td>
      </Table.Tr>
      {expanded && (
        <Table.Tr>
          <Table.Td colSpan={5}>
            <Stack gap={4} py="xs">
              {entry.params !== null && (
                <Text size="xs" c="dimmed">
                  params: {entry.params}
                </Text>
              )}
              <Text size="xs" ff="monospace">
                {entry.config_ref}
              </Text>
              {entry.rationale !== null && <Text size="xs">{entry.rationale}</Text>}
              {entry.decision_doc !== null && (
                <Text size="xs" c="dimmed" ff="monospace">
                  {entry.decision_doc}
                </Text>
              )}
            </Stack>
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

function AllSlotsTable({ deployments }: { deployments: DeploymentEntry[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  return (
    <Table verticalSpacing="sm" highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Service</Table.Th>
          <Table.Th>Slot</Table.Th>
          <Table.Th>Model</Table.Th>
          <Table.Th>Thinking</Table.Th>
          <Table.Th>Status</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {deployments.map((entry) => {
          const key = `${entry.service}/${entry.slot}`;
          return (
            <AllSlotsRow
              key={key}
              entry={entry}
              expanded={expandedKey === key}
              onToggle={() => setExpandedKey(expandedKey === key ? null : key)}
            />
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function AlgoPickCell({ entry }: { entry: StackEntry }) {
  if (entry.algo === null && entry.bench === null) {
    return (
      <Badge color="gray" size="sm" variant="light">
        —
      </Badge>
    );
  }
  const content = (
    <Box style={entry.drift ? { cursor: "help" } : undefined}>
      <Text
        size="sm"
        {...(entry.drift ? { c: "yellow" as const } : {})}
        style={{ lineHeight: 1.2 }}
      >
        {entry.algo?.display_name ?? "—"}
      </Text>
      {entry.bench !== null && (
        <Text size="xs" c="dimmed" mt={4} style={{ lineHeight: 1.4 }}>
          ccbench: {entry.bench.worker?.display_name ?? "—"} (worker) ·{" "}
          {entry.bench.interactive?.display_name ?? "—"} (interactive)
        </Text>
      )}
    </Box>
  );
  if (!entry.drift) return content;
  return (
    <Tooltip label={driftLabel(entry)} multiline w={280} withArrow>
      {content}
    </Tooltip>
  );
}

function StackRow({ entry }: { entry: StackEntry }) {
  const tooltip = pickTooltip(entry);
  const pick = (
    <Box style={tooltip !== null ? { cursor: "help" } : undefined}>
      <Text size="sm" fw={600} style={{ lineHeight: 1.2 }}>
        {entry.pick.display_name}
      </Text>
      <Text size="xs" c="dimmed">
        {entry.pick.provider}
      </Text>
    </Box>
  );

  return (
    <Table.Tr>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <CategoryIcon category={entry.category} />
          <Text size="sm" fw={500}>
            {CATEGORY_LABELS[entry.category]}
          </Text>
        </Group>
      </Table.Td>
      <Table.Td>
        {tooltip !== null ? (
          <Tooltip label={tooltip} multiline w={320} withArrow>
            {pick}
          </Tooltip>
        ) : (
          pick
        )}
      </Table.Td>
      <Table.Td>
        {entry.slotCount === 0 ? (
          <Tooltip label="Nothing in the deployment table runs this model — the pick is not wired to any job.">
            <Badge color="red" size="sm" variant="light">
              0 slots
            </Badge>
          </Tooltip>
        ) : (
          <Text size="sm" c="dimmed">
            {entry.slotCount}
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <AlgoPickCell entry={entry} />
      </Table.Td>
    </Table.Tr>
  );
}

function StackPage() {
  const data = Route.useLoaderData();

  const flagged = data.deployments
    .filter((d) => d.flags.length > 0)
    .toSorted((a, b) => {
      const sevDiff = severityIndex(a.flags) - severityIndex(b.flags);
      return sevDiff !== 0 ? sevDiff : a.service.localeCompare(b.service);
    });

  if (data.deployments.length === 0) {
    return (
      <Stack gap="xl" pt="md">
        <Title order={2}>Stack</Title>
        <Paper p="xl" withBorder ta="center">
          <Text c="dimmed" size="sm">
            No deployments recorded yet.
          </Text>
        </Paper>
      </Stack>
    );
  }

  return (
    <Stack gap="xl" pt="md">
      <Box>
        <Title order={2}>Stack</Title>
        <Text size="sm" c="dimmed">
          What every service actually runs. {data.deployments.length} slots, {flagged.length} need
          attention.
        </Text>
      </Box>

      <Box>
        <Title order={3} mb="sm">
          Needs attention
        </Title>
        {flagged.length === 0 ? (
          <Text c="green" size="sm">
            Nothing flagged — every slot matches its recorded decision.
          </Text>
        ) : (
          <Paper withBorder>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Slot</Table.Th>
                  <Table.Th>Runs</Table.Th>
                  <Table.Th>Issue</Table.Th>
                  <Table.Th>Why</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {flagged.map((entry) => (
                  <NeedsAttentionRow key={`${entry.service}-${entry.slot}`} entry={entry} />
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </Box>

      <Accordion multiple variant="separated">
        <Accordion.Item value="all-slots">
          <Accordion.Control>All slots ({data.deployments.length})</Accordion.Control>
          <Accordion.Panel>
            <AllSlotsTable deployments={data.deployments} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="category-picks">
          <Accordion.Control>Category picks</Accordion.Control>
          <Accordion.Panel>
            {data.entries.length === 0 ? (
              <Text c="dimmed" size="sm">
                No stack choices yet. Run{" "}
                <Text component="span" ff="monospace" size="sm">
                  bun run db:seed
                </Text>{" "}
                to load them.
              </Text>
            ) : (
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Category</Table.Th>
                    <Table.Th>My pick</Table.Th>
                    <Table.Th>Slots</Table.Th>
                    <Table.Th>Algo pick</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.entries.map((entry) => (
                    <StackRow key={entry.category} entry={entry} />
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
