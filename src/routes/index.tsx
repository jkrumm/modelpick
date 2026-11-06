import { createFileRoute, redirect } from "@tanstack/react-router";

// modelpick is a data server plus the TTS playground; the decision surface lives in Argo.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/tts" });
  },
});
