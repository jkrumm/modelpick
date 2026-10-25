// Gemini 3.8 quality experiments (audio-gateway Wave 5): chunk length, English terms, numbers. Usage:
//   secrets-run run --env-file=.env.tpl -- bun scripts/tts-wave5.ts --exp chunks|english|numbers [--dry-run]
// Writes samples (set "wave5") into the TTS manifest and the measurements into data/tts-compare/wave5-<exp>.json.
// Request shapes: docs/gemini-tts.md. The numbers are the evidence behind the defaults in audio-gateway.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCompareDir, type CompareManifest, type CompareSample } from "../src/server/audio/compare";
import { normalizeForSpeech } from "../../audio-gateway/src/gemini-tts-core";

const KEY = process.env.IU_API_KEY!;
const OAI = process.env.IU_OPENAI_BASE_URL!;
const GEM = process.env.IU_GEMINI_BASE_URL!;
const H = { Authorization: `Bearer ${KEY}`, "x-goog-api-key": KEY, "content-type": "application/json" };
const args = process.argv.slice(2);
const exp = args[args.indexOf("--exp") + 1];
const dry = args.includes("--dry-run");
const FLASH = "gemini-3.8-flash-tts";
const RATE = 25 * 9; // $ per 1M tokens × tokens/s → micro-dollars per audio second (intro price)
const STT_PER_MIN = 0.006;
const STYLE = "calm, warm, conversational";

// ── audio + metric helpers ───────────────────────────────────────────────────
const SR = 24000;
const silence = (ms: number) => Buffer.alloc(Math.round((SR * 2 * ms) / 1000));
const pcmToWav = (pcm: Buffer) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
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
const words = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/(\d+),(\d+)/g, (_, a, b) => `${a} komma ${b}`).replace(/\d+/g, (d) => numDe(Number(d)))
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

/** Edit-distance alignment; returns ins/del/sub counts and, per ref word, the matched hyp index (-1 = dropped). */
function align(ref: string[], hyp: string[]) {
  const n = ref.length, m = hyp.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const map: number[] = Array.from({ length: n }, () => -1);
  let dropped = 0, added = 0, subs = 0;
  for (let i = n, j = m; i > 0 || j > 0; ) {
    if (i > 0 && j > 0 && d[i]![j]! === d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      map[i - 1] = j - 1;
      if (ref[i - 1] !== hyp[j - 1]) subs++;
      i--; j--;
    } else if (i > 0 && d[i]![j]! === d[i - 1]![j]! + 1) { dropped++; i--; }
    else { added++; j--; }
  }
  return { wer: d[n]![m]! / Math.max(n, 1), dropped, added, subs, map };
}

/** Per 10 s window: RMS dBFS and median F0 (Hz, autocorrelation on 8 kHz decimated audio, voiced frames only). */
function windows(pcm: Buffer, f0 = true) {
  const x = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const out: { t: number; rmsDb: number; f0: number | null }[] = [];
  for (let s = 0; s < x.length; s += SR * 10) {
    const seg = x.subarray(s, Math.min(s + SR * 10, x.length));
    if (seg.length < SR * 3) break; // skip a short tail
    let e = 0; for (const v of seg) e += v * v;
    const rmsDb = 20 * Math.log10(Math.sqrt(e / seg.length) / 32768 + 1e-9);
    let med: number | null = null;
    if (f0) {
      const dec = new Float32Array(Math.floor(seg.length / 3));
      for (let i = 0; i < dec.length; i++) dec[i] = (seg[3 * i]! + seg[3 * i + 1]! + seg[3 * i + 2]!) / 3;
      const fr = 320, hop = 160, f: number[] = [];
      for (let a = 0; a + fr < dec.length; a += hop) {
        let en = 0; for (let i = 0; i < fr; i++) en += dec[a + i]! * dec[a + i]!;
        if (Math.sqrt(en / fr) < 600) continue;
        let best = 0, lag = 0;
        for (let l = 27; l <= 114; l++) { // 8000/l → 70–300 Hz
          let c = 0; for (let i = 0; i + l < fr; i++) c += dec[a + i]! * dec[a + i + l]!;
          if (c > best) { best = c; lag = l; }
        }
        if (lag && best / en > 0.45) f.push(8000 / lag);
      }
      f.sort((p, q) => p - q);
      med = f.length > 20 ? Math.round(f[Math.floor(f.length / 2)]!) : null;
    }
    out.push({ t: s / SR, rmsDb: Math.round(rmsDb * 10) / 10, f0: med });
  }
  return out;
}
const spread = (v: (number | null)[]) => { const a = v.filter((n): n is number => n !== null); return a.length ? Math.round((Math.max(...a) - Math.min(...a)) * 10) / 10 : null; };
const maxStep = (v: (number | null)[]) => { let m = 0; for (let i = 1; i < v.length; i++) if (v[i] !== null && v[i - 1] !== null) m = Math.max(m, Math.abs(v[i]! - v[i - 1]!)); return Math.round(m * 10) / 10; };

// ── IU calls ─────────────────────────────────────────────────────────────────
const wavPcm = (b: Buffer) => { // unary asks AUDIO_L16 → headerless; keep the guard anyway
  if (b.toString("latin1", 0, 4) !== "RIFF") return b;
  for (let at = 12; at + 8 <= b.length; ) {
    const size = b.readUInt32LE(at + 4);
    if (b.toString("latin1", at, at + 4) === "data") return b.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
};
async function gen(parts: Record<string, unknown>[], speech: Record<string, unknown>): Promise<{ pcm: Buffer; ms: number }> {
  const t0 = performance.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GEM}/models/${FLASH}:generateContent`, {
      method: "POST", headers: H,
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["AUDIO"], responseFormat: { audio: { mimeType: "AUDIO_L16" } }, speechConfig: speech } }),
    });
    const body = await res.text();
    if (!res.ok) {
      if (attempt < 2 && res.status >= 500) continue;
      throw new Error(`${res.status} ${body.slice(0, 200)}`);
    }
    const data = JSON.parse(body).candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
    if (!data) throw new Error("no audio");
    return { pcm: wavPcm(Buffer.from(data, "base64")), ms: Math.round(performance.now() - t0) };
  }
}
const voiceCfg = (v: string) => ({ voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } });
const duoCfg = (a: string, b: string) => ({ multiSpeakerVoiceConfig: { speakerVoiceConfigs: [
  { speaker: "Mark", voiceConfig: { prebuiltVoiceConfig: { voiceName: a } } },
  { speaker: "Sarah", voiceConfig: { prebuiltVoiceConfig: { voiceName: b } } },
] } });

async function stt(wav: Buffer, model: string, diarize = false): Promise<{ text: string; segments: { speaker: string; text: string }[] }> {
  const form = new FormData();
  form.append("model", model);
  form.append("language", "de");
  if (diarize) { form.append("response_format", "diarized_json"); form.append("chunking_strategy", "auto"); }
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "a.wav");
  const res = await fetch(`${OAI}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form });
  if (!res.ok) throw new Error(`stt ${model} ${res.status} ${(await res.text()).slice(0, 160)}`);
  const j: any = await res.json();
  return { text: j.text ?? (j.segments ?? []).map((s: any) => s.text).join(" "), segments: (j.segments ?? []).map((s: any) => ({ speaker: String(s.speaker), text: String(s.text) })) };
}

// ── manifest ─────────────────────────────────────────────────────────────────
const dir = getCompareDir();
const audioDir = join(dir, "audio");
const manifestPath = join(dir, "manifest.json");
let spent = 0;
async function loadManifest(): Promise<CompareManifest> {
  try { return JSON.parse(await readFile(manifestPath, "utf8")); } catch { return { generated_at: "", texts: {}, samples: [] }; }
}
async function addSample(id: string, preset: CompareSample["preset"], voice: string, mode: CompareSample["mode"], pcm: Buffer, request: string, ms: number, chars: number, verbatim: boolean | null, diff: string) {
  await mkdir(audioDir, { recursive: true });
  const file = `${id}.wav`;
  await writeFile(join(audioDir, file), pcmToWav(pcm));
  const dur = pcm.length / (SR * 2);
  const cost = dur * RATE / 1e6;
  spent += cost + (dur / 60) * STT_PER_MIN;
  const m = await loadManifest(); // re-read: the STT session edits the same file
  m.samples = [...m.samples.filter((s) => s.id !== id), {
    id, preset, model: FLASH, voice, gender: "mixed", file, mode, set: "wave5", request, latency_ms: ms, first_audio_ms: null,
    duration_s: Math.round(dur * 10) / 10, chars, cost_usd: Math.round(cost * 1e5) / 1e5, cost_per_min: Math.round((cost / dur) * 60 * 1e4) / 1e4,
    cost_source: "Gemini 3.8 audio-out tokens (duration × 25/s) × list price, intro rate to 2026-12-31",
    verbatim, diff, streaming: "n/a — unary generateContent (L16)", aa_rank: "#5 (1280)",
  } as CompareSample];
  await writeFile(manifestPath, JSON.stringify(m, null, 2) + "\n");
}
async function setText(key: string, text: string) {
  const m = await loadManifest();
  m.texts[key] = text;
  await writeFile(manifestPath, JSON.stringify(m, null, 2) + "\n");
}

// ── pack text into requests ──────────────────────────────────────────────────
function packSentences(text: string, max: number): string[] {
  const sents = text.match(/[^.!?]+[.!?]+(\s+|$)/g)!.map((s) => s.trim());
  const out: string[] = [];
  let cur = "";
  for (const s of sents) {
    if (cur && (cur + " " + s).length > max) { out.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}
type Turn = { who: "Mark" | "Sarah"; text: string };
function packTurns(turns: Turn[], max: number): Turn[][] {
  const out: Turn[][] = [];
  let cur: Turn[] = [], len = 0;
  for (const t of turns) {
    if (cur.length && len + t.text.length > max) { out.push(cur); cur = []; len = 0; }
    cur.push(t); len += t.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ═════════════════════════════ EXPERIMENT: chunks ════════════════════════════
const DUO: Turn[] = [
  ["Mark", "Wir reden heute über etwas, das jeder kennt und trotzdem kaum jemand versteht: warum Züge in Deutschland zu spät kommen."],
  ["Sarah", "Und ich vermute, die ehrliche Antwort ist langweiliger als der Ärger darüber. Es liegt nicht an einem einzelnen Fehler, oder?"],
  ["Mark", "Genau. Das Netz ist an vielen Stellen so dicht befahren, dass ein einziger verspäteter Güterzug eine Kette auslöst, die sich über Stunden durch das ganze Land zieht."],
  ["Sarah", "Wie bei einem Stau auf der Autobahn, der sich auch dann noch hält, wenn der Unfall längst weggeräumt ist."],
  ["Mark", "Ziemlich genau so. Fachleute sprechen von Verspätungsübertragung. Ein Zug wartet auf den Anschluss, dadurch verpasst der nächste sein Zeitfenster, und plötzlich steht ein Regionalexpress hinter einem Intercity, der eigentlich schon lange weg sein sollte."],
  ["Sarah", "Was mich überrascht hat: Pünktlichkeit hängt gar nicht so stark an den Zügen selbst, sondern an den Gleisen und Weichen."],
  ["Mark", "Richtig. Eine Weichenstörung am falschen Knoten legt manchmal ein ganzes Dreieck aus Strecken lahm. Und diese Knoten sind selten doppelt vorhanden, es gibt schlicht keinen Umweg."],
  ["Sarah", "Dann ist der Fahrplan eigentlich ein Versprechen, das auf Annahmen beruht, die jeden Tag ein bisschen anders aussehen."],
  ["Mark", "Schön gesagt. Der Fahrplan geht davon aus, dass Bauarbeiten gut geplant sind, dass das Wetter mitspielt und dass niemand an einem Bahnsteig die Tür zu lange aufhält."],
  ["Sarah", "Das mit den Türen kenne ich. Zwei Minuten Verspätung, nur weil jemand noch schnell einen Kaffee holen wollte."],
  ["Mark", "Die Minuten summieren sich, und dann fehlt an der nächsten Station die Reserve. Deshalb bauen Planer Puffer ein, aber jeder Puffer macht die Reise auf dem Papier länger."],
  ["Sarah", "Das ist ein echtes Dilemma. Entweder ein ehrlicher, langsamer Fahrplan oder ein ehrgeiziger, der ständig bricht."],
  ["Mark", "Und beides hat Folgen für das Vertrauen. Wer einmal an einem kalten Abend eine Stunde gewartet hat, rechnet beim nächsten Mal mit dem Schlimmsten."],
  ["Sarah", "Gibt es denn ein Land, das es besser macht? Man hört ja immer von der Schweiz."],
  ["Mark", "Die Schweiz fährt einen Takt, bei dem alle Züge zu festen Minuten an den großen Knoten zusammentreffen. Das Netz ist dafür gebaut, nicht umgekehrt. Man hat zuerst den Takt festgelegt und dann die Strecken entsprechend ausgebaut."],
  ["Sarah", "Also erst die Idee, dann der Beton. Bei uns ist es eher gewachsen, Strecke für Strecke, über hundertfünfzig Jahre."],
  ["Mark", "Genau, und deshalb lässt sich nichts einfach ersetzen. Jede Baustelle muss neben dem laufenden Betrieb stattfinden, wie eine Operation am offenen Herzen."],
  ["Sarah", "Was würdest du dem Fahrgast mitgeben, der morgen früh um sieben am Gleis steht?"],
  ["Mark", "Ehrlich? Ein Puffer von zwanzig Minuten bei jedem wichtigen Termin, die App der Bahn und die Gelassenheit, dass es heute vielleicht doch klappt."],
  ["Sarah", "Das klingt nach einem Plan, mit dem man leben kann. Danke dir, und allen anderen eine pünktliche Fahrt."],
].map(([who, text]) => ({ who, text }) as Turn);

const MONO =
  "Sauerteig ist ein lebendiges Gemisch aus Mehl, Wasser und wilden Hefen, die sich über Tage vermehren. Wer ihn zum ersten Mal ansetzt, braucht vor allem Geduld, denn in den ersten drei Tagen passiert scheinbar nichts. Dann beginnen kleine Bläschen aufzusteigen, und der Geruch wird säuerlich und fruchtig. Jeden Tag wird ein Teil des Ansatzes entfernt und mit frischem Mehl und Wasser gefüttert. So bleibt das Verhältnis zwischen Hefen und Milchsäurebakterien im Gleichgewicht. Die Temperatur spielt eine große Rolle: Bei warmer Küche arbeitet der Teig schneller und wird säuerlicher, bei kühler langsamer und milder. Viele Bäcker lassen den Teig über Nacht im Kühlschrank reifen, weil sich dabei das Aroma entfaltet und die Kruste später besonders knusprig wird. Entscheidend ist der Moment des Backens. Der Ofen sollte sehr heiß sein, und eine Schale mit Wasser sorgt für Dampf, damit das Brot ungehindert aufgehen kann. Nach etwa vierzig Minuten klingt das fertige Brot hohl, wenn man von unten dagegen klopft. Dann kommt der schwierigste Teil: abwarten, bis es abgekühlt ist, denn im Inneren garen die Krume und die Aromen noch weiter. Wer zu früh schneidet, bekommt einen klebrigen Laib. Mit etwas Übung gelingt ein Brot, das tagelang frisch bleibt und besser schmeckt als jedes aus dem Supermarkt. Und das Beste daran: Der Ansatz lebt weiter und kann über Jahre gepflegt oder an Freunde verschenkt werden. Auch die Wahl des Mehls verändert viel. Roggen gärt schnell und liefert einen kräftigen, leicht herben Geschmack, während Weizen mehr Struktur gibt und eine feinporige Krume erzeugt. Viele mischen beides und finden so ihren eigenen Charakter. Wichtig ist außerdem das Gefäß: Ein Glas mit weiter Öffnung lässt sich leicht reinigen, und ein lockerer Deckel verhindert, dass der Druck der Gärgase es sprengt. Wer verreist, stellt den Ansatz einfach kalt, dann hält er sich zwei Wochen ohne Pflege. Nach der Rückkehr füttert man ihn zwei- bis dreimal im Abstand weniger Stunden, und bald ist er wieder voll bei Kräften.";

async function chunksExp() {
  const duoChars = DUO.reduce((s, t) => s + t.text.length, 0);
  console.log(`duo ${duoChars} chars / ${DUO.length} turns, mono ${MONO.length} chars`);
  const duoSizes = [1000, 1500, 2000, 3000];
  const monoSizes = [1000, 1500, 2000];
  const estMin = (duoChars * duoSizes.length + MONO.length * monoSizes.length) / 18 / 60;
  const est = estMin * (RATE * 60 / 1e6 + STT_PER_MIN * 2);
  console.log(`estimated ${estMin.toFixed(1)} min of audio, ~$${est.toFixed(2)}`);
  if (dry) return;
  const results: any[] = [];
  const HOST_STYLE = { Mark: "warm, conversational", Sarah: "curious, lively" } as const;
  const jobs: (() => Promise<void>)[] = [];

  for (const size of duoSizes) jobs.push(async () => {
    const groups = packTurns(DUO, size);
    const bufs: Buffer[] = []; let ms = 0;
    for (const g of groups) {
      const parts = g.map((t) => ({ text: t.text, speechMetadata: { speaker: t.who, style: HOST_STYLE[t.who] } }));
      const r = await gen(parts, duoCfg("Charon", "Erinome"));
      bufs.push(r.pcm, silence(250)); ms += r.ms;
    }
    const pcm = Buffer.concat(bufs);
    const wav = pcmToWav(pcm);
    const ref = words(DUO.map((t) => t.text).join(" "));
    const plain = await stt(wav, "gpt-transcribe");
    const a = align(ref, words(plain.text));
    // speaker attribution via the diarizing model
    let attribution: any = null;
    try {
      const dz = await stt(wav, "gpt-4o-transcribe-diarize", true);
      const hyp: string[] = [], lab: string[] = [];
      for (const s of dz.segments) for (const w of words(s.text)) { hyp.push(w); lab.push(s.speaker); }
      const al = align(ref, hyp);
      let at = 0;
      const perTurn = DUO.map((t) => {
        const n = words(t.text).length;
        const votes: Record<string, number> = {};
        for (let i = at; i < at + n; i++) { const h = al.map[i]!; if (h >= 0) votes[lab[h]!] = (votes[lab[h]!] ?? 0) + 1; }
        at += n;
        return { who: t.who, label: Object.entries(votes).sort((p, q) => q[1] - p[1])[0]?.[0] ?? "?" };
      });
      const map: Record<string, Record<string, number>> = { Mark: {}, Sarah: {} };
      for (const p of perTurn) map[p.who]![p.label] = (map[p.who]![p.label] ?? 0) + 1;
      const best = (w: string) => Object.entries(map[w]!).sort((p, q) => q[1] - p[1])[0]?.[0];
      const ok = perTurn.filter((p) => p.label === best(p.who) && best("Mark") !== best("Sarah")).length;
      attribution = { labels: new Set(lab).size, correctTurns: `${ok}/${perTurn.length}`, wrong: perTurn.map((p, i) => (p.label === best(p.who) ? null : `${i}:${p.who}→${p.label}`)).filter(Boolean) };
    } catch (e) { attribution = { error: String(e).slice(0, 160) }; }
    const w = windows(pcm, false);
    const r = {
      lane: "two-host", chars: size, requests: groups.length, sec: Math.round(pcm.length / 48000), dropped: a.dropped, added: a.added, subs: a.subs,
      wer: Math.round(a.wer * 1000) / 10, attribution, rmsDb: w.map((x) => x.rmsDb), rmsSpread: spread(w.map((x) => x.rmsDb)), rmsMaxStep: maxStep(w.map((x) => x.rmsDb)),
    };
    results.push(r); console.log(JSON.stringify(r));
    await addSample(`w5__chunks__duo-${size}`, "podcast", "Charon + Erinome", "multi", pcm,
      JSON.stringify({ model: FLASH, maxCharsPerRequest: size, requests: groups.length, perPartStyle: HOST_STYLE, join: "250 ms silence" }), ms, duoChars,
      a.dropped + a.added + a.subs === 0, `WER ${r.wer}% · dropped ${a.dropped} added ${a.added} · attribution ${JSON.stringify(attribution.correctTurns ?? attribution)}`);
  });

  for (const size of monoSizes) jobs.push(async () => {
    const groups = packSentences(MONO, size);
    const bufs: Buffer[] = []; let ms = 0;
    for (const g of groups) {
      const r = await gen([{ text: g, speechMetadata: { style: STYLE } }], voiceCfg("Charon"));
      bufs.push(r.pcm, silence(250)); ms += r.ms;
    }
    const pcm = Buffer.concat(bufs);
    const plain = await stt(pcmToWav(pcm), "gpt-transcribe");
    const a = align(words(MONO), words(plain.text));
    const w = windows(pcm);
    const r = {
      lane: "single", chars: size, requests: groups.length, sec: Math.round(pcm.length / 48000), dropped: a.dropped, added: a.added, subs: a.subs,
      wer: Math.round(a.wer * 1000) / 10, rmsDb: w.map((x) => x.rmsDb), rmsSpread: spread(w.map((x) => x.rmsDb)), f0: w.map((x) => x.f0), f0Spread: spread(w.map((x) => x.f0)), f0MaxStep: maxStep(w.map((x) => x.f0)),
    };
    results.push(r); console.log(JSON.stringify(r));
    await addSample(`w5__chunks__mono-${size}`, "briefing", "Charon", "single", pcm,
      JSON.stringify({ model: FLASH, maxCharsPerRequest: size, requests: groups.length, style: STYLE, join: "250 ms silence" }), ms, MONO.length,
      a.dropped + a.added + a.subs === 0, `WER ${r.wer}% · dropped ${a.dropped} added ${a.added} · F0 spread ${r.f0Spread} Hz`);
  });

  await Promise.all(jobs.map((j) => j().catch((e) => console.log("FAIL", String(e).slice(0, 200)))));
  await setText("w5_chunks_duo", DUO.map((t) => `${t.who}: ${t.text}`).join("\n"));
  await setText("w5_chunks_mono", MONO);
  await writeFile(join(dir, "wave5-chunks.json"), JSON.stringify(results, null, 2) + "\n");
}

// ═════════════════════════════ EXPERIMENT: english ═══════════════════════════
const EN_HINT = "calm, warm, conversational; English technical terms and brand names are pronounced in English";
// (a) as an LLM writer would naturally produce it: German compounds, German verb endings
const EN_A =
  "Gestern haben wir das neue Feature im Meeting vorgestellt. Danach habe ich den Pull-Request gemerged, und die Deployment-Pipeline hat das Release automatisch in die Cloud gepusht. Mit Claude Code schreibe ich gerade die Release-Notes, und der Code-Review läuft über GitHub. Falls etwas schiefgeht, gibt es einen Rollback, und das Monitoring in Grafana schlägt sofort Alarm.";
// (c) writer/prep rule: true English terms keep English spelling as separate words, no German compounds/endings
const EN_C =
  "Gestern haben wir das neue Feature im Meeting vorgestellt. Danach habe ich den Pull Request gemerged, und die Deployment Pipeline hat das Release automatisch in die Cloud gepusht. Mit Claude Code schreibe ich gerade die Release Notes, und das Code Review läuft über GitHub. Falls etwas schiefgeht, gibt es einen Rollback, und das Monitoring in Grafana schlägt sofort Alarm.";
const EN_TERMS = ["Feature", "Meeting", "Pull Request", "gemerged", "Deployment Pipeline", "Release", "Cloud", "gepusht", "Claude Code", "Release Notes", "Code Review", "GitHub", "Rollback", "Monitoring", "Grafana"];

async function ear(wav: Buffer): Promise<string> {
  const res = await fetch(`${GEM}/models/gemini-3.8-flash:generateContent`, {
    method: "POST", headers: H,
    body: JSON.stringify({ contents: [{ parts: [
      { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
      { text: `Listen to this German recording. For each of these terms, say whether the speaker pronounces it with ENGLISH phonetics (e.g. "Pull Request" as /pʊl rɪˈkwɛst/), GERMANIZED phonetics, or MIXED. Terms: ${EN_TERMS.join(", ")}. Reply as compact JSON {"term":"english|german|mixed"} and nothing else.` },
    ] }] }),
  });
  if (!res.ok) return `ear failed ${res.status}`;
  const j: any = await res.json();
  return (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").replace(/```json|```/g, "").trim();
}

async function englishExp() {
  const variants = [
    { key: "a-plain", text: EN_A, style: undefined as string | undefined },
    { key: "b-style", text: EN_A, style: EN_HINT },
    { key: "c-rule", text: EN_C, style: undefined },
    { key: "d-rule+style", text: EN_C, style: EN_HINT },
  ];
  const voices = ["Charon", "Erinome"];
  console.log(`${variants.length * voices.length} renders, ~$${(variants.length * voices.length * 0.6 * 0.0135).toFixed(2)}`);
  if (dry) return;
  const results: any[] = [];
  await Promise.all(voices.flatMap((voice) => variants.map(async (v) => {
    const parts = [{ text: v.text, speechMetadata: { style: v.style ?? STYLE } }];
    const r = await gen(parts, voiceCfg(voice));
    const wav = pcmToWav(r.pcm);
    const heard = (await stt(wav, "gpt-transcribe")).text;
    const verdict = await ear(wav);
    spent += 0.01;
    const row = { voice, variant: v.key, heard, ear: verdict };
    results.push(row); console.log(JSON.stringify(row));
    await addSample(`w5__english__${voice}__${v.key}`, "briefing", voice, "single", r.pcm,
      JSON.stringify({ model: FLASH, style: v.style ?? STYLE, text: v.text }), r.ms, v.text.length, null, `ear: ${verdict.slice(0, 300)}`);
  })));
  await setText("w5_english_a", EN_A);
  await setText("w5_english_c", EN_C);
  await writeFile(join(dir, "wave5-english.json"), JSON.stringify(results, null, 2) + "\n");
}

// ═════════════════════════════ EXPERIMENT: numbers ═══════════════════════════
const NUM_RAW =
  "Das Update 3.8.1 erscheint am 14.11.2026 um 15:30 Uhr. Das Abo kostet dann 1.299,50 € im Jahr, also 12 % weniger als bisher. Zuletzt hatten wir 4.237 Nutzer in 18 Ländern, und die Antwortzeit liegt bei 0,35 Sekunden.";
const NUM_SPELLED =
  "Das Update drei Punkt acht Punkt eins erscheint am vierzehnten November zweitausendsechsundzwanzig um fünfzehn Uhr dreißig. Das Abo kostet dann eintausendzweihundertneunundneunzig Euro fünfzig im Jahr, also zwölf Prozent weniger als bisher. Zuletzt hatten wir viertausendzweihundertsiebenunddreißig Nutzer in achtzehn Ländern, und die Antwortzeit liegt bei null Komma drei fünf Sekunden.";
const NUM_ROUNDED =
  "Das Update drei Punkt acht erscheint Mitte November, kurz nach halb vier am Nachmittag. Das Abo kostet dann rund dreizehnhundert Euro im Jahr, gut ein Achtel weniger als bisher. Zuletzt hatten wir etwas über viertausend Nutzer in knapp zwanzig Ländern, und die Antwort kommt in einer drittel Sekunde.";

async function numbersExp() {
  const variants = [
    { key: "a-digits-normalized", text: normalizeForSpeech(NUM_RAW, "de"), style: STYLE, ref: NUM_SPELLED },
    { key: "b-spelled", text: NUM_SPELLED, style: STYLE, ref: NUM_SPELLED },
    { key: "c-spelled-slow", text: NUM_SPELLED, style: "speaking slowly and clearly", ref: NUM_SPELLED },
    { key: "d-rounded", text: NUM_ROUNDED, style: STYLE, ref: NUM_ROUNDED },
  ];
  const voices = ["Charon", "Erinome"];
  console.log(`${variants.length * voices.length} renders, ~$${(variants.length * voices.length * 0.4 * 0.0135).toFixed(2)}`);
  if (dry) return;
  const results: any[] = [];
  await Promise.all(voices.flatMap((voice) => variants.map(async (v) => {
    const r = await gen([{ text: v.text, speechMetadata: { style: v.style } }], voiceCfg(voice));
    const heard = (await stt(pcmToWav(r.pcm), "gpt-transcribe")).text;
    const a = align(words(v.ref), words(heard));
    const row = { voice, variant: v.key, sec: Math.round((r.pcm.length / 48000) * 10) / 10, sent: v.text, heard, dropped: a.dropped, added: a.added, subs: a.subs };
    results.push(row); console.log(JSON.stringify(row));
    await addSample(`w5__numbers__${voice}__${v.key}`, "briefing", voice, "single", r.pcm,
      JSON.stringify({ model: FLASH, style: v.style, text: v.text }), r.ms, v.text.length, a.dropped + a.added + a.subs === 0, `heard: ${heard.slice(0, 220)}`);
  })));
  await setText("w5_numbers_raw", NUM_RAW);
  await writeFile(join(dir, "wave5-numbers.json"), JSON.stringify(results, null, 2) + "\n");
}

// Repeat the plain / short / long style hint three times each — the single run above was noisier than the effect.
async function englishHintExp() {
  const hints = { plain: STYLE, short: "calm, warm; English terms pronounced in English", long: EN_HINT };
  if (dry) return;
  const out: any[] = [];
  await Promise.all(Object.entries(hints).flatMap(([k, style]) => [1, 2, 3].map(async (rep) => {
    const r = await gen([{ text: EN_A, speechMetadata: { style } }], voiceCfg("Charon"));
    const verdict = await ear(pcmToWav(r.pcm));
    spent += 0.02;
    let score: number | null = null;
    try {
      const j = JSON.parse(verdict) as Record<string, string>;
      score = Object.values(j).reduce((a, v) => a + (v === "english" ? 1 : v === "mixed" ? 0.5 : 0), 0);
    } catch {}
    out.push({ hint: k, rep, score }); console.log(JSON.stringify({ hint: k, rep, score }));
  })));
  await writeFile(join(dir, "wave5-english-hint.json"), JSON.stringify(out, null, 2) + "\n");
}

if (exp === "english-hint") await englishHintExp();
else if (exp === "chunks") await chunksExp();
else if (exp === "english") await englishExp();
else if (exp === "numbers") await numbersExp();
else { console.error("--exp chunks|english|numbers"); process.exit(1); }
const m = await loadManifest();
m.generated_at = new Date().toISOString().slice(0, 10);
await writeFile(manifestPath, JSON.stringify(m, null, 2) + "\n");
console.log(`done. estimated spend $${spent.toFixed(3)}`);
