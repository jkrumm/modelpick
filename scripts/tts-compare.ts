// German TTS comparison generator. Usage:
//   secrets-run run --env-file=.env.tpl -- bun scripts/tts-compare.ts [--only <model-substring>] [--dry-run]
// Writes data/tts-compare/audio/* and merges rows into data/tts-compare/manifest.json.
// List prices only; IU spend is estimated from them (IU returns no cost for these routes).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pcmToWav } from "../src/server/audio/generate";
import { getCompareDir, type CompareManifest, type CompareSample } from "../src/server/audio/compare";

const KEY = process.env.IU_API_KEY!;
const OAI = process.env.IU_OPENAI_BASE_URL!;
const GEM = process.env.IU_GEMINI_BASE_URL!;
const REP = OAI.replace(/\/openai\/v1$/, "/replicate/v1");
const auth = { Authorization: `Bearer ${KEY}` };
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const dry = args.includes("--dry-run");
const BUDGET_USD = 2.5;

const TEXTS = {
  chat: "Klar, mach ich. Der Termin am 14. November um 15:30 Uhr ist eingetragen – und ich erinnere dich eine Stunde vorher.",
  briefing:
    "Achtzehn Monate, zwei Firmen, ein Ziel: Die Stadtwerke wollten bis zweitausendsiebenundzwanzig komplett auf Wärmepumpen umstellen. Und dann – Stille. Kein Budget, kein Personal, keine Antwort aus dem Rathaus. Ehrlich gesagt, ich fand das erst lustig. Bis ich die Zahlen gesehen habe: vier Komma zwei Millionen Euro, verbrannt in einem Pilotprojekt, das nie ein einziges Haus beheizt hat. Das ist kein Scheitern. Das ist ein Muster.",
} as const;
const TURNS: { who: "Mark" | "Sarah"; text: string }[] = [
  { who: "Mark", text: "Willkommen zurück. Heute geht es um die Frage, warum Wärmepumpen in Stadtwerken so oft im Pilotprojekt stecken bleiben." },
  { who: "Sarah", text: "Und das ist keine Frage der Technik, oder? Ich habe gelesen, dass es meistens am Geld hängt." },
  { who: "Mark", text: "Genau. Bei einem Projekt waren es vier Komma zwei Millionen Euro, und am Ende wurde kein einziges Haus beheizt." },
  { who: "Sarah", text: "Das ist bitter. Woran lag es denn, am Budget oder am Personal?" },
  { who: "Mark", text: "Ehrlich gesagt an beidem. Und dazu kam das Schweigen aus dem Rathaus, achtzehn Monate lang." },
  { who: "Sarah", text: "Dann lass uns genau dort anfangen." },
];
const PODCAST_TEXT = TURNS.map((t) => `${t.who}: ${t.text}`).join("\n");

type Gender = "m" | "f";
interface Audio { bytes: Uint8Array; ext: string; first_audio_ms: number | null }
type Synth = (text: string, voice: string) => Promise<Audio>;
interface Family {
  model: string;
  aa_rank: string | null;
  streaming: string;
  /** USD per 1,000 input chars (char-billed) or per audio minute. */
  per1kChars?: number;
  perMin?: number;
  cost_source: string;
  voices: { name: string; g: Gender }[];
  presets: ("chat" | "briefing" | "podcast")[];
  synth: Synth;
  /** Multi-speaker single-request podcast: [maleVoice, femaleVoice]. */
  multi?: (pair: [string, string]) => Promise<Audio>;
  /** Podcast pairs (male, female) — one sample each. Defaults to first male + first female. */
  pairs?: [string, string][];
}

const ALL: Family["presets"] = ["chat", "briefing", "podcast"];

async function replicate(model: string, input: Record<string, unknown>): Promise<Audio> {
  const res = await fetch(`${REP}/models/${model}/predictions`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input }),
  });
  let p: any = await res.json();
  const deadline = Date.now() + 150_000;
  while (p.status && Date.now() < deadline && !["succeeded", "failed", "canceled"].includes(p.status)) {
    await new Promise((r) => setTimeout(r, 400));
    p = await (await fetch(`${REP}/predictions/${p.id}`, { headers: auth })).json();
  }
  if (p.status !== "succeeded") throw new Error(`${res.status} ${JSON.stringify(p).slice(0, 300)}`);
  const url = Array.isArray(p.output) ? p.output[0] : p.output;
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return { bytes, ext: url.split("?")[0].split(".").pop() as string, first_audio_ms: null };
}

async function gemini(model: string, parts: Record<string, unknown>[], speech: Record<string, unknown>): Promise<Audio> {
  const t0 = performance.now();
  const res = await fetch(`${GEM}/models/${model}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { ...auth, "x-goog-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: speech },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  const chunks: Buffer[] = [];
  let first: number | null = null;
  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body as any) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = ev.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const d = JSON.parse(line.slice(6))?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (d) {
        first ??= Math.round(performance.now() - t0);
        chunks.push(Buffer.from(d, "base64"));
      }
    }
  }
  if (!chunks.length) throw new Error("no audio in stream");
  return { bytes: new Uint8Array(pcmToWav(Buffer.concat(chunks))), ext: "wav", first_audio_ms: first };
}
const gSingle = (model: string): Synth => (text, voice) =>
  gemini(model, [{ text }], { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } });
const gMulti = (model: string) => ([m, f]: [string, string]) =>
  gemini(model, TURNS.map((t) => ({ text: t.text, speechMetadata: { speaker: t.who } })), {
    multiSpeakerVoiceConfig: {
      speakerVoiceConfigs: [
        { speaker: "Mark", voiceConfig: { prebuiltVoiceConfig: { voiceName: m } } },
        { speaker: "Sarah", voiceConfig: { prebuiltVoiceConfig: { voiceName: f } } },
      ],
    },
  });

async function openaiTts(text: string, voice: string): Promise<Audio> {
  const t0 = performance.now();
  const res = await fetch(`${OAI}/audio/speech`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts-2025-12-15",
      input: text,
      voice,
      instructions: "Sprich wie ein ruhiger, natürlicher deutscher Host, gesprächig, nicht theatralisch.",
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  const parts: Buffer[] = [];
  let first: number | null = null;
  for await (const c of res.body as any) {
    first ??= Math.round(performance.now() - t0);
    parts.push(Buffer.from(c));
  }
  return { bytes: new Uint8Array(Buffer.concat(parts)), ext: "mp3", first_audio_ms: first };
}

const el = (model: string): Synth => (text, voice) =>
  replicate(model, { prompt: text, voice, language_code: "de", stability: 0.5, similarity_boost: 0.75, style: 0 });
const mm = (model: string): Synth => (text, voice) =>
  replicate(model, { text, voice_id: voice, language_boost: "German", emotion: "auto" });

const FAMILIES: Family[] = [
  { model: "gemini-3.8-flash-tts", aa_rank: "#5 (1280)", streaming: "yes — streamGenerateContent SSE", perMin: 25 * 9 / 1e6 * 60, cost_source: "Gemini 3.8 Flash $9/1M audio-out tokens × 25 tok/s (intro price to 2026-12-31)", voices: [{ name: "Charon", g: "m" }, { name: "Rasalgethi", g: "m" }, { name: "Sulafat", g: "f" }], presets: ALL, synth: gSingle("gemini-3.8-flash-tts"), multi: gMulti("gemini-3.8-flash-tts"), pairs: [["Charon", "Sulafat"], ["Rasalgethi", "Sulafat"]] },
  { model: "gemini-3.8-flash-lite-tts", aa_rank: "#8 (1252)", streaming: "yes — streamGenerateContent SSE", perMin: 25 * 6 / 1e6 * 60, cost_source: "Gemini 3.8 Flash-Lite $6/1M audio-out tokens × 25 tok/s", voices: [{ name: "Charon", g: "m" }, { name: "Rasalgethi", g: "m" }, { name: "Sulafat", g: "f" }], presets: ALL, synth: gSingle("gemini-3.8-flash-lite-tts"), multi: gMulti("gemini-3.8-flash-lite-tts"), pairs: [["Charon", "Sulafat"]] },
  { model: "elevenlabs/v3", aa_rank: "#21", streaming: "no — Replicate returns a finished file URL", per1kChars: 0.1, cost_source: "ElevenLabs list $0.10/1k chars (Replicate route, audio-gateway usage.ts)", voices: [{ name: "Mark", g: "m" }, { name: "James", g: "m" }, { name: "Sarah", g: "f" }], presets: ALL, synth: el("elevenlabs/v3"), pairs: [["Mark", "Sarah"]] },
  { model: "elevenlabs/flash-v2.5", aa_rank: "not top 30", streaming: "no — Replicate returns a finished file URL", per1kChars: 0.05, cost_source: "ElevenLabs list $0.05/1k chars (audio-gateway usage.ts, unverified)", voices: [{ name: "Mark", g: "m" }, { name: "James", g: "m" }, { name: "Sarah", g: "f" }], presets: ["chat"], synth: el("elevenlabs/flash-v2.5") },
  { model: "minimax/speech-2.8-hd", aa_rank: "#24", streaming: "no — Replicate returns a finished file URL", per1kChars: 0.1, cost_source: "Replicate page: $0.10/1k input chars", voices: [{ name: "German_FriendlyMan", g: "m" }, { name: "German_PlayfulMan", g: "m" }, { name: "German_SweetLady", g: "f" }], presets: ALL, synth: mm("minimax/speech-2.8-hd"), pairs: [["German_FriendlyMan", "German_SweetLady"]] },
  { model: "minimax/speech-2.8-turbo", aa_rank: "#27", streaming: "no — Replicate returns a finished file URL", per1kChars: 0.06, cost_source: "Replicate page: $0.06/1k input chars", voices: [{ name: "German_FriendlyMan", g: "m" }, { name: "German_SweetLady", g: "f" }], presets: ["chat"], synth: mm("minimax/speech-2.8-turbo") },
  { model: "inworld/realtime-tts-2", aa_rank: "#6 (1261)", streaming: "no via Replicate (native Inworld API streams; not reachable here)", per1kChars: 0.025, cost_source: "Replicate page: $0.025/1k input chars", voices: [{ name: "Dennis", g: "m" }, { name: "Alex", g: "m" }, { name: "Ashley", g: "f" }], presets: ALL, synth: (text, voice) => replicate("inworld/realtime-tts-2", { text, voice_id: voice, language: "de" }), pairs: [["Dennis", "Ashley"]] },
  { model: "xai/grok-text-to-speech", aa_rank: "n/a", streaming: "no via Replicate (native xAI API has a WebSocket; not reachable here)", per1kChars: 0.015, cost_source: "Replicate page: $0.000015/char (xAI 1:1 pass-through)", voices: [{ name: "rex", g: "m" }, { name: "leo", g: "m" }, { name: "ara", g: "f" }], presets: ALL, synth: (text, voice) => replicate("xai/grok-text-to-speech", { text, voice, language: "de" }), pairs: [["rex", "ara"]] },
  { model: "qwen/qwen3-tts", aa_rank: "#87 (930)", streaming: "no — Replicate returns a finished file URL", per1kChars: 0.02, cost_source: "Replicate page: $0.02/1k input chars", voices: [{ name: "Uncle_fu", g: "m" }, { name: "Ryan", g: "m" }, { name: "Serena", g: "f" }], presets: ALL, synth: (text, voice) => replicate("qwen/qwen3-tts", { text, speaker: voice, language: "German", style_instruction: "Sprich ruhig, natürlich und gesprächig" }), pairs: [["Uncle_fu", "Serena"]] },
  { model: "gpt-4o-mini-tts-2025-12-15", aa_rank: "unranked", streaming: "no — IU buffers /audio/speech (first byte ≈ total time)", perMin: 0.015, cost_source: "OpenAI list: ≈$0.015/min (estimate; model deprecated, shuts down 2027-01-06)", voices: [{ name: "cedar", g: "m" }, { name: "onyx", g: "m" }, { name: "coral", g: "f" }], presets: ALL, synth: openaiTts, pairs: [["cedar", "coral"]] },
];

// ── helpers ──────────────────────────────────────────────────────────────────
const slug = (s: string) => s.replace(/[^\w.-]+/g, "-");
const median = (a: number[]) => a.toSorted((x, y) => x - y)[Math.floor(a.length / 2)]!;

async function concatTurns(parts: Audio[], dir: string): Promise<Audio> {
  const files: string[] = [];
  for (const [i, p] of parts.entries()) {
    const f = join(dir, `.tmp-turn-${process.pid}-${i}.${p.ext}`);
    await writeFile(f, p.bytes);
    files.push(f);
  }
  const out = join(dir, `.tmp-concat-${process.pid}.mp3`);
  const inputs = files.flatMap((f) => ["-i", f]);
  const filter = files.map((_, i) => `[${i}:a]aresample=24000,aformat=channel_layouts=mono[a${i}]`).join(";") +
    ";" + files.map((_, i) => `[a${i}]`).join("") + `concat=n=${files.length}:v=0:a=1[o]`;
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[o]", "-b:a", "128k", out]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const bytes = new Uint8Array(await readFile(out));
  spawnSync("rm", ["-f", out, ...files]);
  return { bytes, ext: "mp3", first_audio_ms: null };
}

function durationS(file: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(r.stdout.toString().trim());
}

const ONES = ["null","eins","zwei","drei","vier","fünf","sechs","sieben","acht","neun","zehn","elf","zwölf","dreizehn","vierzehn","fünfzehn","sechzehn","siebzehn","achtzehn","neunzehn"];
const TENS = ["","","zwanzig","dreißig","vierzig","fünfzig","sechzig","siebzig","achtzig","neunzig"];
function numDe(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return (n % 10 ? (n % 10 === 1 ? "ein" : ONES[n % 10]) + "und" : "") + TENS[Math.floor(n / 10)];
  if (n < 1000) return (Math.floor(n / 100) === 1 ? "ein" : ONES[Math.floor(n / 100)]) + "hundert" + (n % 100 ? numDe(n % 100) : "");
  if (n < 1e6) return (Math.floor(n / 1000) === 1 ? "ein" : numDe(Math.floor(n / 1000))) + "tausend" + (n % 1000 ? numDe(n % 1000) : "");
  return String(n);
}
const spellNumbers = (s: string) => s.replace(/(\d+),(\d+)/g, (_, a, b) => `${a} komma ${b}`).replace(/\d+/g, (d) => numDe(Number(d)));
const norm = (s: string) =>
  spellNumbers(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

function wordDiff(ref: string[], hyp: string[]): { wer: number; diff: string } {
  const n = ref.length, m = hyp.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const wer = d[n]![m]! / Math.max(n, 1);
  const refSet = new Set(ref), hypSet = new Set(hyp);
  const missing = ref.filter((w) => !hypSet.has(w));
  const extra = hyp.filter((w) => !refSet.has(w));
  return { wer, diff: wer === 0 ? "" : `WER ${(wer * 100).toFixed(1)}% · missing: ${missing.join(" ") || "—"} · heard: ${extra.join(" ") || "—"}` };
}

async function transcribe(file: string, ext: string): Promise<string> {
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("language", "de");
  form.append("file", new Blob([await readFile(file)], { type: ext === "mp3" ? "audio/mpeg" : "audio/wav" }), `a.${ext}`);
  const res = await fetch(`${OAI}/audio/transcriptions`, { method: "POST", headers: auth, body: form });
  if (!res.ok) throw new Error(`transcribe ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as any).text as string;
}

// ── run ──────────────────────────────────────────────────────────────────────
const dir = getCompareDir();
const audioDir = join(dir, "audio");
await mkdir(audioDir, { recursive: true });

interface Job { fam: Family; preset: CompareSample["preset"]; voice: string; gender: CompareSample["gender"]; pair?: [string, string] }
const jobs: Job[] = [];
for (const fam of FAMILIES) {
  if (only && !fam.model.includes(only)) continue;
  for (const preset of fam.presets) {
    if (preset === "podcast") {
      for (const pair of fam.pairs ?? []) jobs.push({ fam, preset, voice: `${pair[0]} + ${pair[1]}`, gender: "mixed", pair });
    } else for (const v of fam.voices) jobs.push({ fam, preset, voice: v.name, gender: v.g });
  }
}

const textFor = (preset: Job["preset"]) => (preset === "podcast" ? PODCAST_TEXT : TEXTS[preset]);
const estimate = (j: Job) => {
  const chars = textFor(j.preset).length;
  const runs = j.preset === "chat" ? 3 : 1;
  const secs = chars / 15; // ≈15 chars/s spoken German
  const one = j.fam.per1kChars ? (chars / 1000) * j.fam.per1kChars : (secs / 60) * (j.fam.perMin ?? 0);
  return one * runs;
};
const planned = jobs.reduce((s, j) => s + estimate(j), 0);
console.log(`${jobs.length} samples, estimated spend $${planned.toFixed(3)} (cap $${BUDGET_USD})`);
if (dry || planned > BUDGET_USD) process.exit(dry ? 0 : 1);

const manifestPath = join(dir, "manifest.json");
let manifest: CompareManifest = { generated_at: "", texts: {}, samples: [] };
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
manifest.texts = { chat: TEXTS.chat, briefing: TEXTS.briefing, podcast: PODCAST_TEXT };
let spent = 0;
const skip = new Set(args.includes("--skip-existing") ? manifest.samples.map((x) => x.id) : []);

async function runJob(j: Job): Promise<CompareSample | null> {
  const { fam, preset } = j;
  const text = textFor(preset);
  const runs = preset === "chat" ? 3 : 1;
  const lat: number[] = [];
  const firsts: number[] = [];
  let audio: Audio | undefined;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    if (preset === "podcast") {
      const [m, f] = j.pair!;
      if (fam.multi) audio = await fam.multi([m, f]);
      else {
        const voices = { Mark: m, Sarah: f };
        const parts = await Promise.all(TURNS.map((t) => fam.synth(t.text, voices[t.who])));
        audio = await concatTurns(parts, audioDir);
      }
    } else audio = await fam.synth(text, j.voice);
    lat.push(Math.round(performance.now() - t0));
    if (audio.first_audio_ms !== null) firsts.push(audio.first_audio_ms);
  }
  const id = `${preset}__${slug(fam.model)}__${slug(j.voice)}`;
  const file = `${id}.${audio!.ext}`;
  const path = join(audioDir, file);
  await writeFile(path, audio!.bytes);
  const duration = durationS(path);
  const chars = text.length;
  const cost = fam.per1kChars ? (chars / 1000) * fam.per1kChars : (duration / 60) * (fam.perMin ?? 0);
  spent += cost * runs;
  let verbatim: boolean | null = null;
  let diff = "";
  try {
    const heard = await transcribe(path, audio!.ext);
    const ref = norm(preset === "podcast" ? TURNS.map((t) => t.text).join(" ") : text);
    const r = wordDiff(ref, norm(heard));
    verbatim = r.wer === 0;
    diff = r.diff;
    spent += (duration / 60) * 0.006;
  } catch (e) {
    diff = String(e).slice(0, 200);
  }
  return {
    id, preset, model: fam.model, voice: j.voice, gender: j.gender, file,
    mode: preset !== "podcast" ? "single" : fam.multi ? "multi" : "concat",
    latency_ms: median(lat),
    first_audio_ms: firsts.length ? median(firsts) : null,
    duration_s: Math.round(duration * 10) / 10,
    chars,
    cost_usd: Math.round(cost * 1e5) / 1e5,
    cost_per_min: Math.round((cost / duration) * 60 * 1e4) / 1e4,
    cost_source: fam.cost_source,
    verbatim, diff, streaming: fam.streaming, aa_rank: fam.aa_rank,
  };
}

async function saveManifest() {
  manifest.generated_at = new Date().toISOString().slice(0, 10);
  const order = ["chat", "briefing", "podcast"];
  manifest.samples.sort((a, b) => order.indexOf(a.preset) - order.indexOf(b.preset) || a.model.localeCompare(b.model) || a.voice.localeCompare(b.voice));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

// One worker per model family so a slow model (Qwen ~35 s) never blocks the rest.
await Promise.all(
  FAMILIES.map(async (fam) => {
    for (const j of jobs.filter((x) => x.fam === fam)) {
      if (skip.has(`${j.preset}__${slug(fam.model)}__${slug(j.voice)}`)) continue;
      if (spent > BUDGET_USD) { console.log("budget cap hit, skipping", fam.model); return; }
      try {
        const s = await runJob(j);
        if (!s) continue;
        manifest.samples = [...manifest.samples.filter((x) => x.id !== s.id), s];
        await saveManifest();
        console.log(`ok   ${s.id}  ${s.latency_ms}ms  first=${s.first_audio_ms ?? "-"}  ${s.duration_s}s  ${s.verbatim ? "verbatim" : "diff"}`);
      } catch (e) {
        console.log(`FAIL ${fam.model} ${j.preset} ${j.voice}: ${String(e).slice(0, 200)}`);
      }
    }
  }),
);
manifest.generated_at = new Date().toISOString().slice(0, 10);
const order = ["chat", "briefing", "podcast"];
manifest.samples.sort((a, b) => order.indexOf(a.preset) - order.indexOf(b.preset) || a.model.localeCompare(b.model) || a.voice.localeCompare(b.voice));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`done. estimated spend this run $${spent.toFixed(3)}`);
