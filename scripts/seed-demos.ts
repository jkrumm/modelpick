import { generateTts, writeDemoAudio } from "../src/server/audio/generate.js";
import { insertDemo, updateDemoAudioPath } from "../src/db/queries.js";
import { TTS_PRESETS, TTS_CANDIDATE_VOICES } from "../src/server/audio/presets.js";
import { client } from "../src/db/index.js";

// Populates the TTS playground with public demos for two comparison dimensions:
//   - PRESET × LANG × VOICE on gemini-3.1-flash-tts-preview (the full matrix:
//     every candidate male voice speaking every preset in EN and DE).
//   - tts-hd `standard` EN/DE (onyx) as a neutral OpenAI cross-provider baseline.
const GEMINI = "gemini-3.1-flash-tts-preview";
const BASELINE = "tts-hd";

interface Job {
  model: string;
  preset: (typeof TTS_PRESETS)[number];
  voice: string | null;
}

const jobs: Job[] = [
  ...TTS_CANDIDATE_VOICES.flatMap((v) =>
    TTS_PRESETS.map((preset) => ({ model: GEMINI, preset, voice: v.name })),
  ),
  ...TTS_PRESETS.filter((p) => p.preset === "standard").map((preset) => ({
    model: BASELINE,
    preset,
    voice: null,
  })),
];

/** One attempt; throws on failure so the retry wrapper can catch transient 503s. */
async function run(job: Job): Promise<string> {
  const { model, preset, voice } = job;
  const { audioBuffer, ext, latency_ms } = await generateTts(model, preset.text, {
    ...(voice ? { voice } : {}),
    ...(preset.style ? { style: preset.style } : {}),
  });
  const row = await insertDemo({
    modality: "tts",
    model_id: model,
    text_content: preset.text,
    lang: preset.lang,
    preset: preset.preset,
    voice,
    public: true,
  });
  const path = await writeDemoAudio(row.id, audioBuffer, ext);
  await updateDemoAudioPath(row.id, path);
  return `${path} (${latency_ms}ms)`;
}

const label = (j: Job): string =>
  `${j.model.padEnd(30)} ${(j.voice ?? "—").padEnd(11)} ${j.preset.preset.padEnd(10)} ${j.preset.lang}`;

let ok = 0;
for (const job of jobs) {
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const info = await run(job);
      ok++;
      console.log(`✓ ${label(job)} → ${info}`);
      lastErr = "";
      break;
    } catch (e) {
      lastErr = String(e).slice(0, 140);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastErr) console.log(`✗ ${label(job)} — ${lastErr}`);
}

console.log(`\nGenerated ${ok}/${jobs.length} public demos.`);
await client.end();
