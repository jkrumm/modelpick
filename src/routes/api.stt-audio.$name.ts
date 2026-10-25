import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSttDir } from "~/server/audio/stt-compare";

const MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac" };

// Reads the clip at request time (same pattern as /api/tts-audio), so a rebuilt test set plays without a rebuild.
export const Route = createFileRoute("/api/stt-audio/$name")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const name = params.name;
        if (!/^[\w.-]+$/.test(name) || name.includes("..")) return new Response("bad name", { status: 400 });
        try {
          const buf = await readFile(join(getSttDir(), "audio", name));
          return new Response(new Uint8Array(buf), {
            headers: { "content-type": MIME[name.split(".").pop() ?? ""] ?? "application/octet-stream", "cache-control": "no-cache" },
          });
        } catch {
          return new Response("not found", { status: 404 });
        }
      },
    },
  },
});
