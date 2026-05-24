import { createFileRoute } from '@tanstack/react-router'
import { Title, Text, Stack, Badge, Group } from '@mantine/core'

export const Route = createFileRoute('/tts')({
  component: TtsPage,
})

function TtsPage() {
  return (
    <Stack gap="md" pt="xl">
      <Group align="center" gap="sm">
        <Title order={2}>TTS Playground</Title>
        <Badge variant="outline" color="gray">
          coming soon
        </Badge>
      </Group>
      <Text c="dimmed">
        A/B compare TTS voices across IU-available models on German and English
        text presets. Pre-computed demos served as static audio.
      </Text>
    </Stack>
  )
}
