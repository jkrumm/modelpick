/// <reference types="vite/client" />
import "@mantine/core/styles.css";

import * as React from "react";
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import {
  MantineProvider,
  ColorSchemeScript,
  Group,
  Text,
  Container,
  AppShell,
  AppShellHeader,
  AppShellMain,
  Button,
  ActionIcon,
} from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { VxBridge } from "~/charts/bridge";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "modelpick — LLM · TTS · STT decider" },
    ],
  }),
  shellComponent: RootDocument,
});

const NAV_ITEMS: Array<{ to: string; label: string; exact?: boolean }> = [
  { to: "/", label: "Decider", exact: true },
  { to: "/stack", label: "Stack" },
  { to: "/catalog", label: "Catalog" },
  { to: "/bench", label: "Bench" },
  { to: "/tts", label: "TTS" },
  { to: "/stt", label: "STT" },
  { to: "/news", label: "News" },
];

function NavButtons() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <Group gap="xs">
      {NAV_ITEMS.map(({ to, label, exact }) => {
        const active = exact ? pathname === to : pathname.startsWith(to);
        return (
          <Button
            key={to}
            component={Link}
            to={to}
            variant={active ? "filled" : "subtle"}
            size="sm"
          >
            {label}
          </Button>
        );
      })}
      <ActionIcon
        component={Link}
        to="/admin"
        variant={pathname.startsWith("/admin") ? "filled" : "subtle"}
        size="lg"
        aria-label="Admin"
        title="Admin"
      >
        <IconSettings size={18} />
      </ActionIcon>
    </Group>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
        <HeadContent />
      </head>
      <body>
        <MantineProvider defaultColorScheme="dark">
          <VxBridge>
            <AppShell header={{ height: 56 }} padding="md">
              <AppShellHeader>
                <Container size="xl" h="100%">
                  <Group h="100%" justify="space-between" align="center">
                    <Text fw={700} size="lg" ff="monospace">
                      modelpick
                    </Text>
                    <NavButtons />
                  </Group>
                </Container>
              </AppShellHeader>
              <AppShellMain>
                <Container size="xl">{children}</Container>
              </AppShellMain>
            </AppShell>
          </VxBridge>
        </MantineProvider>
        {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
        <Scripts />
      </body>
    </html>
  );
}
