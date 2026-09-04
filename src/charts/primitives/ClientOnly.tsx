import { useEffect, useState, type ReactNode } from "react";
import { VX } from "../tokens";

/**
 * Gates a visx chart to the client-only render pass.
 *
 * @visx/axis's tick labels go through @visx/text's `getStringWidth`, which measures
 * by mounting a real DOM node — there is no `document` during SSR, so every axis-
 * bearing chart throws server-side (React swallows it and re-renders on the client,
 * which is why pages still returned 200 while flooding the log). Charts also need a
 * real measured element for `useResizeObserver`, so a server render could never be
 * meaningful even if it didn't throw — the fix is to skip the attempt, not shim
 * `document`. `fallbackHeight` reserves the chart's own layout height so the page
 * doesn't jump when the real chart mounts.
 */
export function ClientOnly({
  fallbackHeight,
  children,
}: {
  fallbackHeight: number;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // VX.grid / VX.axisStrokeDark are scheme-neutral alpha tokens, so the
    // placeholder needs no theme lookup — which also keeps it renderable during
    // the server pass, where the whole point is to touch as little as possible.
    return (
      <div
        style={{
          height: fallbackHeight,
          borderRadius: 8,
          border: `1px solid ${VX.axisStrokeDark}`,
          backgroundColor: VX.grid,
          marginBottom: 16,
        }}
      />
    );
  }

  return <>{children}</>;
}
