import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getCompareDir } from "~/server/audio/compare";

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

// Reads the sample at request time, so files generated after the build play without a rebuild.
export const Route = createFileRoute("/api/tts-audio/$name")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const name = params.name;
        if (!/^[\w.-]+$/.test(name) || name.includes("..")) {
          return new Response("bad name", { status: 400 });
        }
        try {
          const buf = await readFile(join(getCompareDir(), "audio", name));
          const ext = name.split(".").pop() ?? "";
          return new Response(new Uint8Array(buf), {
            headers: {
              "content-type": MIME[ext] ?? "application/octet-stream",
              "cache-control": "no-cache",
            },
          });
        } catch {
          return new Response("not found", { status: 404 });
        }
      },
    },
  },
});
