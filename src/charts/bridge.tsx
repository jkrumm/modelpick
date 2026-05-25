import { useMantineColorScheme } from "@mantine/core";
import { VxThemeProvider } from "./theme";
import type { ReactNode } from "react";

/**
 * Single bridge between Mantine's color scheme and the theme-agnostic VxThemeProvider.
 * Wrap the app shell (or any chart-containing subtree) with this once.
 */
export function VxBridge({ children }: { children: ReactNode }) {
  const { colorScheme } = useMantineColorScheme();
  const resolved = colorScheme === "auto" ? "dark" : colorScheme;
  return <VxThemeProvider colorScheme={resolved}>{children}</VxThemeProvider>;
}
