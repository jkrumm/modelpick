import { createFileRoute } from '@tanstack/react-router'
import { Title, Text, Stack, Badge, Group } from '@mantine/core'

export const Route = createFileRoute('/')({
  component: DeciderPage,
})

function DeciderPage() {
  return (
    <Stack gap="md" pt="xl">
      <Group align="center" gap="sm">
        <Title order={2}>LLM Decider</Title>
        <Badge variant="outline" color="gray">
          coming soon
        </Badge>
      </Group>
      <Text c="dimmed">
        Daily-refreshed model rankings for your IU unified endpoint — fast,
        coding, and orchestrator categories with transparent weighted scores.
      </Text>
    </Stack>
  )
}
