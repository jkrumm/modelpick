import { createFileRoute } from "@tanstack/react-router";
import { Badge, Box, Group, Paper, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import {
  IconBolt,
  IconBrain,
  IconCode,
  IconEye,
  IconMicrophone,
  IconPhoto,
  IconSpeakerphone,
  IconVector,
} from "@tabler/icons-react";
import type { StackCategory } from "~/db/schema";
import { getMyStack } from "./-stack-server-fns";
import type { StackEntry } from "./-stack-server-fns";

export const Route = createFileRoute("/stack")({
  loader: async () => getMyStack(),
  component: StackPage,
});

const CATEGORY_LABELS: Record<StackCategory, string> = {
  fast: "Fast",
  coding: "Coding",
  orchestrator: "Orchestrator",
  tts: "TTS",
  stt: "STT",
  embedding: "Embedding",
  vision: "Vision",
  image: "Image Gen",
};

function CategoryIcon({ category }: { category: StackCategory }) {
  const size = 16;
  if (category === "fast") return <IconBolt size={size} />;
  if (category === "coding") return <IconCode size={size} />;
  if (category === "orchestrator") return <IconBrain size={size} />;
  if (category === "tts") return <IconSpeakerphone size={size} />;
  if (category === "stt") return <IconMicrophone size={size} />;
  if (category === "embedding") return <IconVector size={size} />;
  if (category === "vision") return <IconEye size={size} />;
  return <IconPhoto size={size} />; // image
}

function StackRow({ entry }: { entry: StackEntry }) {
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
        <Box>
          <Text size="sm" fw={600} style={{ lineHeight: 1.2 }}>
            {entry.pick.display_name}
          </Text>
          <Text size="xs" c="dimmed">
            {entry.pick.provider}
          </Text>
          {entry.env_note !== null && (
            <Text size="xs" c="dimmed" mt={2} style={{ lineHeight: 1.4 }}>
              {entry.env_note}
            </Text>
          )}
        </Box>
      </Table.Td>
      <Table.Td>
        {entry.algo !== null ? (
          <Box>
            <Text size="sm" style={{ lineHeight: 1.2 }}>
              {entry.algo.display_name}
            </Text>
            <Text size="xs" c="dimmed">
              score {(entry.algo.score * 100).toFixed(1)}
            </Text>
          </Box>
        ) : (
          <Text size="xs" c="dimmed">
            no recommendation
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        {entry.algo === null ? (
          <Badge color="gray" size="sm" variant="light">
            —
          </Badge>
        ) : entry.drift ? (
          <Tooltip label={`Algorithm prefers ${entry.algo.display_name} — review your pick`}>
            <Badge color="yellow" size="sm" variant="light">
              review
            </Badge>
          </Tooltip>
        ) : (
          <Badge color="green" size="sm" variant="light">
            ok
          </Badge>
        )}
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed" style={{ lineHeight: 1.4 }}>
          {entry.rationale}
        </Text>
        <Text size="xs" c="dimmed" mt={2}>
          since {entry.decided_at}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

function StackPage() {
  const data = Route.useLoaderData();

  return (
    <Stack gap="xl" pt="md">
      <Box>
        <Title order={2}>My Stack</Title>
        <Text size="xs" c="dimmed">
          The models I actually use, per category — diffed against the daily algorithmic pick
          {data.snapshotDate !== null && <> (snapshot {data.snapshotDate})</>}.
        </Text>
      </Box>

      {data.entries.length === 0 ? (
        <Paper p="xl" withBorder ta="center">
          <Text c="dimmed" size="sm">
            No stack choices yet. Run{" "}
            <Text component="span" ff="monospace" size="sm">
              bun run db:seed
            </Text>{" "}
            to load them.
          </Text>
        </Paper>
      ) : (
        <Paper withBorder p="md">
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Category</Table.Th>
                <Table.Th>My pick</Table.Th>
                <Table.Th>Algo pick</Table.Th>
                <Table.Th>Drift</Table.Th>
                <Table.Th>Why</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.entries.map((entry) => (
                <StackRow key={entry.category} entry={entry} />
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
