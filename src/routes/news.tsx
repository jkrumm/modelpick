import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Stack, Title, Card, Text, Badge, Group, Anchor, Alert, Code } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { getNewsFeed } from "./-news-server-fns";
import type { NewsItem } from "~/db/schema";

export const Route = createFileRoute("/news")({
  loader: () => getNewsFeed(),
  component: NewsPage,
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface NewsCardProps {
  item: NewsItem;
}

function NewsCard({ item }: NewsCardProps) {
  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={6} style={{ flex: 1 }}>
          <Anchor href={item.url} target="_blank" rel="noopener noreferrer" fw={600} size="sm">
            {item.title}
          </Anchor>
          {item.summary !== null && (
            <Text size="xs" c="dimmed" lineClamp={2}>
              {item.summary}
            </Text>
          )}
          <Group gap="xs">
            <Badge size="xs" variant="outline" color="gray">
              {item.source}
            </Badge>
            <Text size="xs" c="dimmed">
              {formatDate(item.published_at)}
            </Text>
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}

function NewsPage() {
  const news = Route.useLoaderData();

  return (
    <Stack gap="lg">
      <Title order={2}>Model News</Title>

      {news.length === 0 ? (
        <Alert icon={<IconInfoCircle />} title="No news yet" color="blue">
          Run <Code>bun run refresh</Code> or <Code>bun run news</Code> to collect model news from
          OpenRouter.
        </Alert>
      ) : (
        <Stack gap="sm">
          {news.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
