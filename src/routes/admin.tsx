import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  Group,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useAdmin } from "~/admin/useAdmin";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { adminKey, viewMode, ready, login, logout, setViewMode } = useAdmin();
  const [input, setInput] = useState("");

  const handleLogin = () => {
    if (input.trim()) {
      login(input.trim());
      setInput("");
    }
  };

  return (
    <Stack gap="lg" maw={520}>
      <div>
        <Title order={2}>Admin</Title>
        <Text c="dimmed" size="sm">
          Unlock live TTS/STT generation and demo management. The key is stored in this browser only
          and checked server-side on every action.
        </Text>
      </div>

      {!ready ? null : adminKey === null ? (
        <Card withBorder padding="lg">
          <Stack gap="sm">
            <Text fw={600}>Log in</Text>
            <PasswordInput
              label="Admin key"
              placeholder="Enter admin key"
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLogin();
              }}
            />
            <Group justify="flex-end">
              <Button onClick={handleLogin} disabled={!input.trim()}>
                Log in
              </Button>
            </Group>
          </Stack>
        </Card>
      ) : (
        <Card withBorder padding="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={600}>Logged in</Text>
              <Badge color={viewMode === "admin" ? "teal" : "gray"} variant="light">
                {viewMode === "admin" ? "Admin view" : "Visitor view"}
              </Badge>
            </Group>
            <div>
              <Text size="sm" mb={6}>
                View mode
              </Text>
              <SegmentedControl
                value={viewMode}
                onChange={(v) => setViewMode(v === "visitor" ? "visitor" : "admin")}
                data={[
                  { label: "Admin", value: "admin" },
                  { label: "Visitor", value: "visitor" },
                ]}
                fullWidth
              />
              <Text c="dimmed" size="xs" mt={6}>
                Switch to Visitor to preview the public experience without logging out. Your key
                stays saved.
              </Text>
            </div>
            <Group justify="flex-end">
              <Button variant="light" color="red" onClick={logout}>
                Log out
              </Button>
            </Group>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
