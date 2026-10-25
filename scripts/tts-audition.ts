// Gemini 3.8 voice audition through the real lane pipeline. Usage:
//   secrets-run run --env-file=.env.tpl -- bun scripts/tts-audition.ts [--dry-run] [--only <voice>]
// Same German material + same tags/style across voices; each sample records the exact request.
// Findings behind the request shapes: docs/gemini-tts.md (IU probe matrix).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getCompareDir, type CompareManifest, type CompareSample } from "../src/server/audio/compare";

const KEY = process.env.IU_API_KEY!;
const OAI = process.env.IU_OPENAI_BASE_URL!;
const GEM = process.env.IU_GEMINI_BASE_URL!;
const H = { Authorization: `Bearer ${KEY}`, "x-goog-api-key": KEY, "content-type": "application/json" };
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const BUDGET_USD = 0.9;

const LITE = "gemini-3.8-flash-lite-tts";
const FLASH = "gemini-3.8-flash-tts";
// $/1M audio-out tokens × 25 tok/s (intro price to 2026-12-31).
const PER_MIN = { [LITE]: (25 * 6 * 60) / 1e6, [FLASH]: (25 * 9 * 60) / 1e6 };

// (1) Chat: raw reply, prep off, no style — exactly what the chat lane sends.
const CHAT = "Klar, mach ich. Der Termin am 14. November um 15:30 Uhr ist eingetragen – und ich erinnere dich eine Stunde vorher.";

// (2) Briefing: raw source text, then the prototype 3.8 prep (spoken numbers, chunks, one short style, point tags).
const BRIEFING_RAW =
  "18 Monate, 2 Firmen, 1 Ziel: Die Stadtwerke wollten bis 2027 komplett auf Wärmepumpen umstellen. Und dann – Stille. Kein Budget, kein Personal, keine Antwort aus dem Rathaus. Ehrlich gesagt, ich fand das erst lustig. Bis ich die Zahlen gesehen habe: 4,2 Mio. € verbrannt in einem Pilotprojekt, das nie ein einziges Haus beheizt hat. Das ist kein Scheitern. Das ist ein Muster.";
const BRIEFING_STYLE = "calm, warm, conversational";
const BRIEFING_CHUNKS = [
  "Achtzehn Monate, zwei Firmen, ein Ziel: Die Stadtwerke wollten bis zweitausendsiebenundzwanzig komplett auf Wärmepumpen umstellen. Und dann – <short pause> Stille. Kein Budget, kein Personal, keine Antwort aus dem Rathaus.",
  "Ehrlich gesagt, ich fand das erst lustig. Bis ich die Zahlen gesehen habe: vier Komma zwei Millionen Euro verbrannt in einem Pilotprojekt, das nie ein einziges Haus beheizt hat. Das ist kein Scheitern. <long pause> Das ist ein Muster.",
];

// (3) Podcast excerpt: per-turn short style, point tags, a question, an emphatic (caps) line, a laugh, a sigh.
const TURNS: { who: "Mark" | "Sarah"; style: string; text: string }[] = [
  { who: "Mark", style: "warm, conversational", text: "Willkommen zurück. Heute geht es um eine Frage, die harmlos klingt: Warum bleiben Wärmepumpen in Stadtwerken im Pilotprojekt stecken?" },
  { who: "Sarah", style: "curious", text: "Und die Antwort ist wahrscheinlich nicht die Technik, oder? <short pause> Ich habe gelesen, es hängt meistens am Geld." },
  { who: "Mark", style: "serious, a little incredulous", text: "Genau. Bei einem Projekt waren es vier Komma zwei Millionen Euro – und am Ende wurde kein EINZIGES Haus beheizt. <sigh> Kein einziges." },
  { who: "Sarah", style: "amused, then apologetic", text: "Das ist bitter. <laugh> Entschuldige, das ist gar nicht lustig. Aber achtzehn Monate Schweigen aus dem Rathaus – wie macht man das?" },
  { who: "Mark", style: "dry, matter-of-fact", text: "Ehrlich gesagt: mit Absicht. <long pause> Und genau dort fangen wir an." },
];

const MALES = ["Charon", "Rasalgethi", "Sadaltager", "Iapetus", "Algieba", "Achird"];
const FEMALES = ["Sulafat", "Vindemiatrix", "Kore", "Despina", "Gacrux", "Erinome", "Callirrhoe", "Laomedeia"];
const MALE_PARTNER = "Sulafat"; // host B for male alternatives
const FEMALE_PARTNER = "Charon"; // host A for female candidates

// ── helpers ──────────────────────────────────────────────────────────────────
// 3.8 unary returns audio/wav, 24 kHz mono s16le, with a trailing C2PA chunk after `data` — walk the chunks, never slice(44).
const wavPcm = (b: Buffer) => {
  if (b.toString("latin1", 0, 4) !== "RIFF") return b;
  for (let at = 12; at + 8 <= b.length; ) {
    const size = b.readUInt32LE(at + 4);
    if (b.toString("latin1", at, at + 4) === "data") return b.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
};
const ONES = ["null","eins","zwei","drei","vier","fünf","sechs","sieben","acht","neun","zehn","elf","zwölf","dreizehn","vierzehn","fünfzehn","sechzehn","siebzehn","achtzehn","neunzehn"];
const TENS = ["","","zwanzig","dreißig","vierzig","fünfzig","sechzig","siebzig","achtzig","neunzig"];
function numDe(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return (n % 10 ? (n % 10 === 1 ? "ein" : ONES[n % 10]) + "und" : "") + TENS[Math.floor(n / 10)];
  if (n < 1000) return (Math.floor(n / 100) === 1 ? "ein" : ONES[Math.floor(n / 100)]) + "hundert" + (n % 100 ? numDe(n % 100) : "");
  if (n < 1e6) return (Math.floor(n / 1000) === 1 ? "ein" : numDe(Math.floor(n / 1000))) + "tausend" + (n % 1000 ? numDe(n % 1000) : "");
  return String(n);
}
const norm = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/\b(\d+)\.\s+November\b/g, "$1 November")
    .replace(/(\d+):(\d+) Uhr/g, (_, h, m) => `${h} Uhr ${m}`)
    .replace(/(\d+),(\d+)/g, (_, a, b) => `${a} komma ${b}`).replace(/Mio\. €/g, "Millionen Euro")
    .replace(/\d+/g, (d) => numDe(Number(d))).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
function wer(ref: string[], hyp: string[]): number {
  const n = ref.length, m = hyp.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return d[n]![m]! / Math.max(n, 1);
}

interface Synth { pcm: Buffer; tokens: number; ms: number }
async function gen(model: string, parts: Record<string, unknown>[], speech: Record<string, unknown>): Promise<Synth> {
  const t0 = performance.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GEM}/models/${model}:generateContent`, {
      method: "POST", headers: H,
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: speech } }),
    });
    const body = await res.text();
    if (!res.ok) {
      if (attempt < 2 && res.status >= 500 && !body.includes("BadRequest")) continue;
      throw new Error(`${res.status} ${body.slice(0, 200)}`);
    }
    const j = JSON.parse(body);
    const data = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
    if (!data) throw new Error("no audio");
    return { pcm: wavPcm(Buffer.from(data, "base64")), tokens: j.usageMetadata?.candidatesTokenCount ?? 0, ms: Math.round(performance.now() - t0) };
  }
}
const voiceCfg = (v: string) => ({ voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } });
const pcmToWav = (pcm: Buffer) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};
const silence = (ms: number) => Buffer.alloc(Math.round((24000 * 2 * ms) / 1000));

async function transcribe(wav: Buffer): Promise<string> {
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("language", "de");
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "a.wav");
  const res = await fetch(`${OAI}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form });
  if (!res.ok) throw new Error(`transcribe ${res.status}`);
  return ((await res.json()) as any).text as string;
}

// ── jobs ─────────────────────────────────────────────────────────────────────
type Preset = CompareSample["preset"];
interface Job { preset: Preset; voice: string; label: string; gender: CompareSample["gender"]; partner?: string; hostA?: string; hostB?: string }
const jobs: Job[] = [];
for (const v of [...MALES, ...FEMALES]) {
  if (only && v !== only) continue;
  const g = MALES.includes(v) ? "m" : "f";
  jobs.push({ preset: "chat", voice: v, label: v, gender: g });
  jobs.push({ preset: "briefing", voice: v, label: v, gender: g });
}
const podPairs: [string, string][] = [
  ...MALES.filter((m) => m !== "Charon").map((m) => [m, MALE_PARTNER] as [string, string]),
  ...FEMALES.map((f) => [FEMALE_PARTNER, f] as [string, string]),
];
for (const [a, b] of podPairs) {
  if (only && a !== only && b !== only) continue;
  jobs.push({ preset: "podcast", voice: `${a} + ${b}`, label: `${a} + ${b}`, gender: "mixed", hostA: a, hostB: b });
}

const estSecs = { chat: 9, briefing: 45, podcast: 55 };
const estimate = (j: Job) => (estSecs[j.preset] / 60) * (j.preset === "chat" ? PER_MIN[LITE] : PER_MIN[FLASH]) + (j.preset === "chat" ? 0 : (estSecs[j.preset] / 60) * 0.006);
const planned = jobs.reduce((s, j) => s + estimate(j), 0);
console.log(`${jobs.length} samples, estimated spend $${planned.toFixed(3)} (cap $${BUDGET_USD})`);
if (dry || planned > BUDGET_USD) process.exit(dry ? 0 : 1);

const dir = getCompareDir();
const audioDir = join(dir, "audio");
await mkdir(audioDir, { recursive: true });
const manifestPath = join(dir, "manifest.json");
let manifest: CompareManifest = { generated_at: "", texts: {}, samples: [] };
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
manifest.texts.aud_chat = CHAT;
manifest.texts.aud_briefing = `RAW: ${BRIEFING_RAW}\n\nAFTER PREP (style "${BRIEFING_STYLE}" on every chunk):\n${BRIEFING_CHUNKS.map((c, i) => `[chunk ${i + 1}] ${c}`).join("\n")}`;
manifest.texts.aud_podcast = TURNS.map((t) => `${t.who} (${t.style}): ${t.text}`).join("\n");

let spent = 0;
async function run(j: Job): Promise<CompareSample> {
  let pcm: Buffer, tokens = 0, ms = 0, request: string, model: string, refText: string, mode: CompareSample["mode"] = "single";
  if (j.preset === "chat") {
    model = LITE;
    const parts = [{ text: CHAT }];
    const r = await gen(model, parts, voiceCfg(j.voice));
    ({ pcm, tokens, ms } = r);
    refText = CHAT;
    request = JSON.stringify({ model, parts, speechConfig: voiceCfg(j.voice), note: "chat lane: prep off, no style, raw digits" });
  } else if (j.preset === "briefing") {
    model = FLASH;
    const bufs: Buffer[] = [];
    for (const c of BRIEFING_CHUNKS) {
      const r = await gen(model, [{ text: c, speechMetadata: { style: BRIEFING_STYLE } }], voiceCfg(j.voice));
      bufs.push(r.pcm, silence(250)); tokens += r.tokens; ms += r.ms;
    }
    pcm = Buffer.concat(bufs);
    refText = BRIEFING_CHUNKS.join(" ");
    request = JSON.stringify({ model, chunks: BRIEFING_CHUNKS.map((text) => ({ text, speechMetadata: { style: BRIEFING_STYLE } })), speechConfig: voiceCfg(j.voice), note: "briefing lane: prototype 3.8 prep, one request per chunk, 250 ms join" });
  } else {
    model = FLASH; mode = "multi";
    const parts = TURNS.map((t) => ({ text: t.text, speechMetadata: { speaker: t.who, style: t.style } }));
    const speech = { multiSpeakerVoiceConfig: { speakerVoiceConfigs: [
      { speaker: "Mark", voiceConfig: { prebuiltVoiceConfig: { voiceName: j.hostA } } },
      { speaker: "Sarah", voiceConfig: { prebuiltVoiceConfig: { voiceName: j.hostB } } },
    ] } };
    const r = await gen(model, parts, speech);
    ({ pcm, tokens, ms } = r);
    refText = TURNS.map((t) => t.text).join(" ");
    request = JSON.stringify({ model, parts, speechConfig: speech, note: "one multi-speaker request, per-part speechMetadata.speaker + style" });
  }
  const id = `aud__${j.preset}__${j.voice.replace(/[^\w.-]+/g, "-")}`;
  const file = `${id}.wav`;
  const wav = pcmToWav(pcm);
  await writeFile(join(audioDir, file), wav);
  const duration = pcm.length / 48000;
  const cost = (tokens || duration * 25) * (model === LITE ? 6 : 9) / 1e6;
  spent += cost;
  let verbatim: boolean | null = null, diff = "";
  try {
    const heard = await transcribe(wav);
    const w = wer(norm(refText), norm(heard));
    verbatim = w === 0;
    diff = w === 0 ? "" : `WER ${(w * 100).toFixed(1)}% · heard: ${heard.slice(0, 160)}`;
    spent += (duration / 60) * 0.006;
  } catch (e) { diff = String(e).slice(0, 120); }
  return {
    id, preset: j.preset, model, voice: j.voice, gender: j.gender, file, mode, set: "audition", request,
    latency_ms: ms, first_audio_ms: null, duration_s: Math.round(duration * 10) / 10, chars: refText.length,
    cost_usd: Math.round(cost * 1e5) / 1e5, cost_per_min: Math.round((cost / duration) * 60 * 1e4) / 1e4,
    cost_source: "Gemini 3.8 audio-out tokens (usageMetadata) × list price, intro rate to 2026-12-31",
    verbatim, diff, streaming: "n/a — unary generateContent (wav)", aa_rank: model === LITE ? "#8 (1252)" : "#5 (1280)",
  };
}

const queue = [...jobs];
async function worker() {
  for (let j = queue.shift(); j; j = queue.shift()) {
    if (spent > BUDGET_USD) { console.log("budget cap hit, skipping", j.preset, j.voice); continue; }
    try {
      const s = await run(j);
      manifest.samples = [...manifest.samples.filter((x) => x.id !== s.id), s];
      console.log(`ok   ${s.id}  ${s.duration_s}s  $${s.cost_usd}  ${s.verbatim ? "verbatim" : "diff: " + s.diff.slice(0, 80)}`);
    } catch (e) { console.log(`FAIL ${j.preset} ${j.voice}: ${String(e).slice(0, 200)}`); }
  }
}
await Promise.all([worker(), worker(), worker()]);
const order = ["chat", "briefing", "podcast"];
manifest.generated_at = new Date().toISOString().slice(0, 10);
manifest.samples.sort((a, b) => order.indexOf(a.preset) - order.indexOf(b.preset) || a.model.localeCompare(b.model) || a.voice.localeCompare(b.voice));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`done. estimated spend this run $${spent.toFixed(3)}`);
