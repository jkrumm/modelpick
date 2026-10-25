// Builds data/stt-compare/ (testset.json tracked, audio/ gitignored) from public German audio.
// Usage: bun scripts/stt-testset.ts [--src /tmp/stt-src]
// Expects in --src: test.tsv + test.tar.gz (google/fleurs de_de test split, CC-BY-4.0, huggingface.co/datasets/google/fleurs),
// storm_schimmelreiter_01_64kb.mp3 (LibriVox, public domain, archive.org/details/schimmelreiter_storm_librivox) and
// schim.txt (Project Gutenberg #74008, public domain). The two-speaker clip reuses a /tts sample + its known script.
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getSttDir, type SttClip, type SttTestset } from "../src/server/audio/stt-compare";

const args = process.argv.slice(2);
const src = (args.includes("--src") ? args[args.indexOf("--src") + 1] : undefined) ?? "/tmp/stt-src";
const dir = getSttDir();
const audio = join(dir, "audio");
await mkdir(audio, { recursive: true });
const sh = (cmd: string, a: string[]) => {
  const r = spawnSync(cmd, a, { stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(" ")}\n${r.stderr}`);
};
const clips: SttClip[] = [];

// 1. FLEURS-de: every 57th row of the test split starting at row 3 (deterministic, 15 clips).
const rows = (await readFile(join(src, "test.tsv"), "utf8")).split("\n").filter(Boolean).map((l) => l.split("\t") as [string, string, string, ...string[]]);
const picked = rows.filter((_, i) => (i + 1) % 57 === 3).slice(0, 15);
const list = join(src, "list.txt");
await writeFile(list, picked.map((r) => `test/${r[1]}`).join("\n"));
await mkdir(join(src, "x"), { recursive: true });
sh("tar", ["-xzf", join(src, "test.tar.gz"), "-C", join(src, "x"), "-T", list]);
for (const r of picked) {
  const id = `fleurs-${r[0]}`;
  sh("ffmpeg", ["-y", "-i", join(src, "x", "test", r[1]), "-ac", "1", "-ar", "16000", join(audio, `${id}.wav`)]);
  clips.push({ id, kind: "short", file: `${id}.wav`, reference: r[2], source: "FLEURS de_de test", licence: "CC-BY-4.0", speakers: 1 });
}

// 2. Noisy / phone-quality: two FLEURS clips band-limited to 300–3400 Hz, 8 kHz, mixed with pink noise at ~12 dB SNR, low-bitrate mp3.
for (const r of picked.slice(2, 4)) {
  const id = `noisy-${r[0]}`;
  sh("ffmpeg", ["-y", "-i", join(src, "x", "test", r[1]), "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.03:sample_rate=16000",
    "-filter_complex", "[0:a]highpass=f=300,lowpass=f=3400,aresample=8000[v];[1:a]aresample=8000[n];[v][n]amix=inputs=2:duration=first:normalize=0",
    "-ac", "1", "-b:a", "24k", join(audio, `${id}.mp3`)]);
  clips.push({ id, kind: "noisy", file: `${id}.mp3`, reference: r[2], source: "FLEURS de_de test, degraded (300–3400 Hz, 8 kHz, pink noise ≈12 dB SNR, 24 kbps mp3)", licence: "CC-BY-4.0", speakers: 1 });
}

// 3. Long-form: first 12 minutes of LibriVox "Der Schimmelreiter" Teil 01 (one narrator, dialogue + dialect). Reference = Gutenberg text;
//    the scorer aligns the hypothesis against a free window of it (the recording opens with a LibriVox intro and the text is not time-aligned).
sh("ffmpeg", ["-y", "-i", join(src, "storm_schimmelreiter_01_64kb.mp3"), "-t", "720", "-ac", "1", "-ar", "16000", "-b:a", "48k", join(audio, "longform-schimmelreiter.mp3")]);
const gut = await readFile(join(src, "schim.txt"), "utf8");
const body = gut.slice(gut.indexOf("Was ich zu berichten beabsichtige"));
clips.push({
  id: "longform-schimmelreiter", kind: "long", file: "longform-schimmelreiter.mp3",
  reference: body.replace(/\s+/g, " ").split(" ").slice(0, 2600).join(" "),
  source: "LibriVox 'Der Schimmelreiter' (Theodor Storm) Teil 01, first 12:00 · text: Project Gutenberg #74008", licence: "Public domain", speakers: 1, windowed: true,
});

// 4. Two speakers with a known script: the Gemini 3.8 two-host podcast sample from /tts (synthetic, public script). Diarization check.
const TURNS = [
  ["Mark", "Willkommen zurück. Heute geht es um die Frage, warum Wärmepumpen in Stadtwerken so oft im Pilotprojekt stecken bleiben."],
  ["Sarah", "Und das ist keine Frage der Technik, oder? Ich habe gelesen, dass es meistens am Geld hängt."],
  ["Mark", "Genau. Bei einem Projekt waren es vier Komma zwei Millionen Euro, und am Ende wurde kein einziges Haus beheizt."],
  ["Sarah", "Das ist bitter. Woran lag es denn, am Budget oder am Personal?"],
  ["Mark", "Ehrlich gesagt an beidem. Und dazu kam das Schweigen aus dem Rathaus, achtzehn Monate lang."],
  ["Sarah", "Dann lass uns genau dort anfangen."],
] as const;
await copyFile(join("data", "tts-compare", "audio", "podcast__gemini-3.8-flash-tts__Charon-Sulafat.wav"), join(audio, "duo-podcast.wav"));
clips.push({
  id: "duo-podcast", kind: "duo", file: "duo-podcast.wav", reference: TURNS.map((t) => t[1]).join(" "),
  source: "/tts Gemini 3.8 Flash two-host sample (synthetic; script is the public /tts podcast script)", licence: "own", speakers: 2,
  turns: TURNS.map(([speaker, text]) => ({ speaker, text })),
});

const set: SttTestset = { generated_at: new Date().toISOString(), clips };
await writeFile(join(dir, "testset.json"), JSON.stringify(set, null, 1));
console.log(`${clips.length} clips -> ${dir}`);
