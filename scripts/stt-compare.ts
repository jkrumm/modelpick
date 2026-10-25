// German STT comparison runner. Usage:
//   secrets-run run --env-file=.env.tpl -- bun scripts/stt-compare.ts [--only <model-substring>] [--skip-existing] [--dry-run] [--local-only|--cloud-only]
// Reads data/stt-compare/testset.json (build it with scripts/stt-testset.ts), writes data/stt-compare/results.json.
// IU spend is estimated from list prices (IU returns no cost for these routes) and capped at $1.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  getSttDir, readSttResults, readSttTestset,
  type SttClip, type SttModelInfo, type SttResult, type SttResults,
} from "../src/server/audio/stt-compare";
import { normalizeText, rawTokens, speakerAccuracy, wer, type SpeakerSeg } from "../src/server/audio/stt-score";

const KEY = process.env.IU_API_KEY!;
const OAI = process.env.IU_OPENAI_BASE_URL!;
const GEM = process.env.IU_GEMINI_BASE_URL!;
const REP = OAI.replace(/\/openai\/v1$/, "/replicate/v1");
const auth = { Authorization: `Bearer ${KEY}` };
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const dry = args.includes("--dry-run");
const skipExisting = args.includes("--skip-existing");
const BUDGET_USD = 1;
const TIMEOUT_MS = 420_000;
const MW = "/Applications/MacWhisper.app/Contents/MacOS/mw";
const REMOTE_DIR = "/tmp/stt-compare-audio";

interface Out { text: string; segs?: SpeakerSeg[] | undefined; request: string }
interface Adapter extends SttModelInfo {
  /** Bill rounding: Replicate Scribe bills a started minute per call. */
  roundUpMinute?: boolean;
  run: (clip: SttClip, bytes: Buffer, diarize: boolean) => Promise<Out>;
}

const mimeOf = (f: string) => (f.endsWith(".wav") ? "audio/wav" : "audio/mpeg");
// Replicate derives the file extension from the data-URI mime: audio/wav yields '' and xAI rejects it; audio/x-wav works.
const replicateMime = (f: string) => (f.endsWith(".wav") ? "audio/x-wav" : "audio/mpeg");

function openai(model: string, extra: Record<string, string> = {}, diar?: (j: any) => SpeakerSeg[] | undefined): Adapter["run"] {
  return async (clip, bytes, diarize) => {
    const form = new FormData();
    form.append("model", model);
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeOf(clip.file) }), clip.file);
    form.append("language", "de");
    const fields: Record<string, string> = { ...extra };
    if (diarize) Object.assign(fields, model.startsWith("voxtral") ? { diarize: "true", "timestamp_granularities[]": "segment" } : {});
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${OAI}/audio/transcriptions`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
    const j: any = await res.json();
    const segs = diarize ? diar?.(j) : undefined;
    return { text: j.text as string, segs, request: `POST /openai/v1/audio/transcriptions model=${model} language=de${Object.entries(fields).map(([k, v]) => ` ${k}=${v}`).join("")}` };
  };
}

async function replicate(model: string, input: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${REP}/models/${model}/predictions`, {
    method: "POST", headers: { ...auth, "content-type": "application/json", Prefer: "wait" }, body: JSON.stringify({ input }), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let p: any = await res.json();
  const deadline = Date.now() + 300_000;
  while (p.status && Date.now() < deadline && !["succeeded", "failed", "canceled"].includes(p.status)) {
    await new Promise((r) => setTimeout(r, 1000));
    p = await (await fetch(`${REP}/predictions/${p.id}`, { headers: auth })).json();
  }
  if (p.status !== "succeeded") throw new Error(`${res.status} ${JSON.stringify(p.error ?? p).slice(0, 300)}`);
  return p.output;
}

const wordsToSegs = (words: any[] | null | undefined, spk: (w: any) => string | undefined): SpeakerSeg[] | undefined => {
  const segs: SpeakerSeg[] = [];
  for (const w of words ?? []) {
    if (w.type && w.type !== "word") continue;
    const s = spk(w);
    if (!s) return undefined;
    const last = segs.at(-1);
    if (last?.speaker === s) last.text += ` ${w.text}`;
    else segs.push({ speaker: s, text: w.text });
  }
  return segs;
};

const ADAPTERS: Adapter[] = [
  {
    model: "gpt-transcribe", where: "iu", residency: "US (OpenAI vendor key)", per_min: 0.0045,
    cost_source: "OpenAI list, $0.0045/min (research 2026-10-25)", diarization: "no", word_timestamps: "no",
    howto: "POST /openai/v1/audio/transcriptions (multipart: model, file, language=de). response_format json/text only — verbose_json/srt are rejected. Prompt-only formatting. 25 MB per request.",
    run: openai("gpt-transcribe"),
  },
  {
    model: "gpt-4o-transcribe", where: "iu", residency: "US (OpenAI vendor key)", per_min: 0.006,
    cost_source: "OpenAI list, $0.006/min", diarization: "no", word_timestamps: "no",
    howto: "Same call as gpt-transcribe. Shuts down 2027-02-26. Loops on long audio past ~10 min.",
    run: openai("gpt-4o-transcribe"),
  },
  {
    model: "gpt-4o-transcribe-diarize", where: "iu", residency: "US (OpenAI vendor key)", per_min: 0.006,
    cost_source: "OpenAI list: $2.50/$10 per 1M audio tokens, est. $0.006/min (developers.openai.com pricing)", diarization: "yes — speaker A/B labels per segment", word_timestamps: "segment",
    howto: "Same endpoint with response_format=diarized_json and chunking_strategy=auto (required for >30 s). Segments carry speaker, start, end. Shuts down 2027-02-26, no successor.",
    run: async (clip, bytes, diarize) => {
      const form = new FormData();
      form.append("model", "gpt-4o-transcribe-diarize");
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeOf(clip.file) }), clip.file);
      form.append("response_format", "diarized_json");
      form.append("chunking_strategy", "auto");
      const res = await fetch(`${OAI}/audio/transcriptions`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
      const j: any = await res.json();
      const segs: SpeakerSeg[] = (j.segments ?? []).map((s: any) => ({ speaker: String(s.speaker), text: String(s.text).trim() }));
      return { text: segs.map((s) => s.text).join(" "), segs: diarize ? segs : undefined, request: "POST /openai/v1/audio/transcriptions model=gpt-4o-transcribe-diarize response_format=diarized_json chunking_strategy=auto (no language param)" };
    },
  },
  {
    model: "whisper", where: "iu", residency: "EU (Sweden Central, Azure)", per_min: 0.006,
    cost_source: "OpenAI whisper-1 list, $0.006/min (developers.openai.com pricing)", diarization: "no", word_timestamps: "yes (verbose_json)",
    howto: "Same call; the only IU STT that accepts response_format=verbose_json/srt for timestamps. Azure-hosted, EU. whisper-1 shuts down 2027-02-26.",
    run: openai("whisper"),
  },
  {
    model: "voxtral-small-transcribe-3-0", where: "iu", residency: "EU (Mistral La Plateforme)", per_min: 0.004,
    cost_source: "Mistral API pricing, $0.004/min (docs.mistral.ai/inference/pricing)", diarization: "yes — diarize=true needs timestamp_granularities=segment; ≤10 speakers", word_timestamps: "no (segment only; word granularity → 400)",
    howto: "Same OpenAI-compatible endpoint. Extra form fields pass through: diarize=true plus timestamp_granularities[]=segment (diarize alone → 422) return segments[].speaker_id. `language` is accepted but the response reports null. Docs: 60 min / 500 MB per file, public preview since 2026-10-20.",
    run: openai("voxtral-small-transcribe-3-0", {}, (j) => (j.segments ?? []).filter((s: any) => s.speaker_id !== null && s.speaker_id !== undefined).map((s: any) => ({ speaker: String(s.speaker_id), text: String(s.text).trim() }))),
  },
  {
    model: "voxtral-mini-transcribe-3-0", where: "iu", residency: "EU (Mistral La Plateforme)", per_min: 0.0035,
    cost_source: "Mistral API pricing, $0.0035/min (docs.mistral.ai/inference/pricing)", diarization: "yes — same fields as small", word_timestamps: "segment",
    howto: "As voxtral-small. Half the price, same API shape.",
    run: openai("voxtral-mini-transcribe-3-0", {}, (j) => (j.segments ?? []).filter((s: any) => s.speaker_id !== null && s.speaker_id !== undefined).map((s: any) => ({ speaker: String(s.speaker_id), text: String(s.text).trim() }))),
  },
  {
    model: "gemini-3.5-transcribe", where: "iu", residency: "Google (IU Gemini route, region unverified)", per_min: 0.005,
    cost_source: "Google list ~$0.005/min (research 2026-10-25)", diarization: "not observed on this route (prompted speaker labels ignored)", word_timestamps: "no",
    howto: "NOT the OpenAI route (503: Cloud Speech-to-Text API disabled on the IU project). Use the Gemini route: POST /gemini/v1beta/models/gemini-3.5-transcribe:generateContent with parts [{text: prompt}, {inlineData: {mimeType, data: base64}}]. The answer is candidates[0].content.parts[0].audioTranscription.text, not a text part.",
    run: async (clip, bytes) => {
      const res = await fetch(`${GEM}/models/gemini-3.5-transcribe:generateContent`, {
        method: "POST", headers: { ...auth, "x-goog-api-key": KEY, "content-type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({ contents: [{ parts: [{ text: "Transcribe this German audio verbatim." }, { inlineData: { mimeType: mimeOf(clip.file), data: bytes.toString("base64") } }] }] }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
      const j: any = await res.json();
      const parts: any[] = j.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.audioTranscription?.text ?? p.text ?? "").join(" ").trim();
      if (!text) throw new Error(`no transcription in response ${JSON.stringify(j).slice(0, 200)}`);
      return { text, request: "POST /gemini/v1beta/models/gemini-3.5-transcribe:generateContent  parts=[text prompt, inlineData audio]" };
    },
  },
  {
    model: "elevenlabs/scribe-v2", where: "iu", residency: "Replicate → ElevenLabs (US, unverified)", per_min: 0.003667, roundUpMinute: true,
    cost_source: "ElevenLabs API $0.22/h = $0.003667/min; Replicate lists $3.667/1000 outputs (unit undefined) and its logs show a started minute billed per call", diarization: "yes — diarize=true, speaker_id per word", word_timestamps: "yes (per word)",
    howto: "POST /replicate/v1/models/elevenlabs/scribe-v2/predictions, Prefer: wait, input {audio, language_code: \"deu\", diarize: true}. `audio` is a URL or data URI. The proxy blocks the Replicate files API, so use a data URI. Output has words[] with speaker_id. Billed per started minute per call — short clips cost a full minute.",
    run: async (clip, bytes, diarize) => {
      const out = await replicate("elevenlabs/scribe-v2", { audio: `data:${replicateMime(clip.file)};base64,${bytes.toString("base64")}`, language_code: "deu", diarize });
      return { text: out.text, segs: diarize ? wordsToSegs(out.words, (w) => w.speaker_id) : undefined, request: `POST /replicate/v1/models/elevenlabs/scribe-v2/predictions input={audio: data URI, language_code: "deu", diarize: ${diarize}}` };
    },
  },
  {
    model: "xai/grok-speech-to-text", where: "iu", residency: "Replicate → xAI (US, unverified)", per_min: 0.001667, roundUpMinute: true,
    cost_source: "xAI $0.10/h batch = $0.001667/min (docs.x.ai pricing); Replicate bills per minute rounded up", diarization: "yes — diarize=true, integer speaker per word (docs)", word_timestamps: "yes (words[] start/end, docs)",
    howto: "POST /replicate/v1/models/xai/grok-speech-to-text/predictions, input {audio, language: \"de\", diarize: true, timestamps: true}. diarize alone returns words: null — speaker labels ride on the word list, which needs timestamps: true. Limit 500 MB, no published duration cap. TRAP: Replicate derives the file extension from the data-URI mime — audio/wav yields '' and xAI fails with \"Invalid audio format ''\"; send audio/x-wav (or audio/mpeg).",
    run: async (clip, bytes, diarize) => {
      const out = await replicate("xai/grok-speech-to-text", { audio: `data:${replicateMime(clip.file)};base64,${bytes.toString("base64")}`, language: "de", ...(diarize ? { diarize: true, timestamps: true } : {}) });
      return { text: out.text, segs: diarize ? wordsToSegs(out.words, (w) => (w.speaker === null || w.speaker === undefined ? undefined : String(w.speaker))) : undefined, request: `POST /replicate/v1/models/xai/grok-speech-to-text/predictions input={audio: data URI ${replicateMime(clip.file)}, language: "de"${diarize ? ", diarize: true, timestamps: true" : ""}}` };
    },
  },
];

const LOCAL: { model: string; label: string; size: string }[] = [
  { model: "qwen3-asr:qwen3-asr-1.7b", label: "MacWhisper · Qwen3-ASR 1.7B", size: "1.77 GB" },
  { model: "parakeet-pro:nvidia_parakeet-v3", label: "MacWhisper · Parakeet v3", size: "1.24 GB" },
  { model: "whisperkit:openai_whisper-large-v3-v20240930", label: "MacWhisper · WhisperKit large-v3 Turbo", size: "—" },
];
const LOCAL_INFO: SttModelInfo[] = LOCAL.map((l) => ({
  model: l.label, where: "local", residency: "on-device (MacBook)", per_min: 0, cost_source: "local, no per-minute cost", diarization: "MacWhisper --speakers (not run)", word_timestamps: "yes (json/srt)",
  howto: `ssh iumac ${MW} transcribe --model ${l.model} --language de --format txt --no-timestamps --no-speakers <file>. --model selects per call and does not change the app's selection. Audio must be on the MacBook. Wall time includes process start and model load.`,
}));

function score(clip: SttClip, model: string, where: "iu" | "local", out: Out | null, err: string | null, ms: number | null, audioS: number, request: string, diarOn: boolean): SttResult {
  const base = { clip: clip.id, model, where, latency_ms: ms, audio_s: audioS, rtf: ms === null ? null : ms / 1000 / audioS, request };
  if (!out) return { ...base, ok: false, error: err ?? "failed", hypothesis: "", wer_norm: null, wer_raw: null, ref_words: 0, hyp_words: 0 };
  const win = clip.windowed === true;
  const norm = wer(normalizeText(clip.reference), normalizeText(out.text), win);
  const raw = wer(rawTokens(clip.reference), rawTokens(out.text), win);
  const r: SttResult = { ...base, ok: true, hypothesis: out.text, wer_norm: norm.wer, wer_raw: raw.wer, ref_words: norm.refWords, hyp_words: normalizeText(out.text).length };
  if (diarOn && clip.turns) {
    r.speakers_detected = out.segs ? new Set(out.segs.map((s) => s.speaker)).size : null;
    r.speaker_acc = out.segs ? speakerAccuracy(clip.turns, out.segs) : null;
  }
  return r;
}

async function audioSeconds(path: string): Promise<number> {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" });
  return Number(r.stdout.trim());
}

const dir = getSttDir();
const testset = await readSttTestset();
if (!testset.clips.length) throw new Error("no testset — run scripts/stt-testset.ts first");
const durations = new Map<string, number>();
for (const c of testset.clips) durations.set(c.id, await audioSeconds(join(dir, "audio", c.file)));
const totalMin = [...durations.values()].reduce((a, b) => a + b, 0) / 60;

const prev: SttResults = skipExisting ? await readSttResults() : { generated_at: "", models: [], results: [], spend_usd: 0 };
const results: SttResult[] = [...prev.results];
const have = new Set(results.filter((r) => r.ok).map((r) => `${r.model}|${r.clip}`));
const cloud = ADAPTERS.filter((a) => !only || a.model.includes(only)).filter(() => !args.includes("--local-only"));
const local = LOCAL.filter((l) => !only || l.label.toLowerCase().includes(only.toLowerCase())).filter(() => !args.includes("--cloud-only"));

const billedMin = (a: Adapter, c: SttClip) => (a.roundUpMinute ? Math.ceil(durations.get(c.id)! / 60) : durations.get(c.id)! / 60);
const estimate = cloud.reduce((s, a) => s + testset.clips.reduce((x, c) => x + billedMin(a, c) * (a.per_min ?? 0), 0), 0);
console.log(`${testset.clips.length} clips, ${totalMin.toFixed(1)} audio-min, ${cloud.length} cloud + ${local.length} local models, est. IU spend $${estimate.toFixed(3)}`);
if (estimate > BUDGET_USD) throw new Error(`estimate $${estimate.toFixed(2)} exceeds the $${BUDGET_USD} cap`);
if (dry) process.exit(0);

let spend = prev.spend_usd;
async function save() {
  const models: SttModelInfo[] = [...ADAPTERS, ...LOCAL_INFO].map(({ model, where, residency, per_min, cost_source, diarization, word_timestamps, howto }) => ({ model, where, residency, per_min, cost_source, diarization, word_timestamps, howto }));
  const out: SttResults = { generated_at: new Date().toISOString(), models, results, spend_usd: Number(spend.toFixed(4)) };
  await writeFile(join(dir, "results.json"), JSON.stringify(out, null, 1));
}
function put(r: SttResult) {
  const i = results.findIndex((x) => x.model === r.model && x.clip === r.clip);
  if (i >= 0) results[i] = r;
  else results.push(r);
}

for (const a of cloud) {
  for (const clip of testset.clips) {
    if (have.has(`${a.model}|${clip.id}`)) continue;
    const bytes = await readFile(join(dir, "audio", clip.file));
    const diarize = clip.kind === "duo" && a.diarization.startsWith("yes");
    const t0 = performance.now();
    let out: Out | null = null;
    let err: string | null = null;
    for (let attempt = 0; attempt < 4 && !out; attempt++) {
      try {
        out = await a.run(clip, bytes, diarize);
        err = null;
      } catch (e) {
        err = (e as Error).message;
        // Azure whisper in Sweden Central rate-limits bursts (503 TooManyRequests): back off and retry.
        if (!/TooManyRequests|RateLimit|\b429\b/.test(err)) break;
        await new Promise((r) => setTimeout(r, 25_000));
      }
    }
    const ms = Math.round(performance.now() - t0);
    spend += billedMin(a, clip) * (a.per_min ?? 0);
    const r = score(clip, a.model, "iu", out, err, ms, durations.get(clip.id)!, out?.request ?? a.howto.split(".")[0]!, diarize);
    put(r);
    console.log(`${a.model.padEnd(30)} ${clip.id.padEnd(26)} ${r.ok ? `WER ${(r.wer_norm! * 100).toFixed(1)}% raw ${(r.wer_raw! * 100).toFixed(1)}% ${ms}ms` : `FAIL ${err}`}`);
    await save();
    if (spend > BUDGET_USD) throw new Error(`spend cap hit at $${spend.toFixed(3)}`);
  }
}

if (local.length) {
  const sync = spawnSync("rsync", ["-a", "--delete", `${join(dir, "audio")}/`, `iumac:${REMOTE_DIR}/`], { encoding: "utf8" });
  if (sync.status !== 0) throw new Error(`rsync to iumac failed: ${sync.stderr}`);
  for (const l of local) {
    for (const clip of testset.clips) {
      const label = l.label;
      if (have.has(`${label}|${clip.id}`)) continue;
      const t0 = performance.now();
      const r0 = spawnSync("ssh", ["iumac", MW, "transcribe", "--model", l.model, "--language", "de", "--format", "txt", "--no-timestamps", "--no-speakers", `${REMOTE_DIR}/${clip.file}`], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 1_800_000 });
      const ms = Math.round(performance.now() - t0);
      const text = r0.stdout.replace(/^Transcribing .*\.\.\.\n?/m, "").trim();
      const ok = r0.status === 0 && text.length > 0;
      const r = score(clip, label, "local", ok ? { text, request: `ssh iumac mw transcribe --model ${l.model} --language de --format txt --no-timestamps --no-speakers` } : null, ok ? null : (r0.stderr || `exit ${r0.status}`).slice(0, 300), ms, durations.get(clip.id)!, `mw transcribe --model ${l.model} --language de`, false);
      put(r);
      console.log(`${label.padEnd(44)} ${clip.id.padEnd(26)} ${r.ok ? `WER ${(r.wer_norm! * 100).toFixed(1)}% raw ${(r.wer_raw! * 100).toFixed(1)}% ${ms}ms` : `FAIL ${r.error}`}`);
      await save();
    }
  }
}
await save();
console.log(`done. estimated IU spend $${spend.toFixed(3)}`);
