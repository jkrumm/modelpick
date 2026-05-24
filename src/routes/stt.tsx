import { createFileRoute } from '@tanstack/react-router'
import { Title, Text, Stack, Badge, Group } from '@mantine/core'

export const Route = createFileRoute('/stt')({
  component: SttPage,
})

function SttPage() {
  return (
    <Stack gap="md" pt="xl">
      <Group align="center" gap="sm">
        <Title order={2}>STT Playground</Title>
        <Badge variant="outline" color="gray">
          coming soon
        </Badge>
      </Group>
      <Text c="dimmed">
        Static sample transcriptions per model — accuracy and latency
        side-by-side. Admin can upload a clip and run it live across models.
      </Text>
    </Stack>
  )
}
