// Word-error-rate scoring for the German STT comparison. Pure functions, no I/O.

/** Open-ASR-style normalisation: lowercase, drop punctuation/quotes, hyphens become spaces. Digits are kept as written. */
export function normalizeText(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/[\p{P}\p{S}]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Raw tokens: whitespace split only, so casing and attached punctuation count as errors. */
export function rawTokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

export interface WerScore {
  errors: number;
  /** Reference words actually scored (the aligned window when `windowed`). */
  refWords: number;
  wer: number;
  /** Window of the reference that was scored: [refStart, refEnd). The whole reference unless `windowed`. */
  refStart: number;
  refEnd: number;
}

/**
 * Levenshtein WER. With `windowed` the reference may start and end anywhere (free prefix/suffix) — for a recording
 * whose text is a larger, untimed document. The denominator is then the length of the matched reference window.
 */
export function wer(ref: string[], hyp: string[], windowed = false): WerScore {
  const n = ref.length;
  const m = hyp.length;
  if (m === 0) return { errors: n, refWords: n, wer: n === 0 ? 0 : 1, refStart: 0, refEnd: n };
  // rows indexed by hyp position j, columns by ref position i; carry the window start along the best path.
  let prev = new Int32Array(n + 1);
  let prevStart = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    prev[i] = windowed ? 0 : i;
    prevStart[i] = windowed ? i : 0;
  }
  for (let j = 1; j <= m; j++) {
    const cur = new Int32Array(n + 1);
    const curStart = new Int32Array(n + 1);
    cur[0] = j;
    curStart[0] = 0;
    for (let i = 1; i <= n; i++) {
      const sub = prev[i - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      const del = cur[i - 1]! + 1; // reference word missing from hypothesis
      const ins = prev[i]! + 1; // extra hypothesis word
      if (sub <= del && sub <= ins) {
        cur[i] = sub;
        curStart[i] = prevStart[i - 1]!;
      } else if (del <= ins) {
        cur[i] = del;
        curStart[i] = curStart[i - 1]!;
      } else {
        cur[i] = ins;
        curStart[i] = prevStart[i]!;
      }
    }
    prev = cur;
    prevStart = curStart;
  }
  let endI = n;
  if (windowed) {
    for (let i = 0; i <= n; i++) if (prev[i]! < prev[endI]!) endI = i;
  }
  const errors = prev[endI]!;
  const refStart = windowed ? prevStart[endI]! : 0;
  const refWords = endI - refStart;
  return { errors, refWords, wer: refWords === 0 ? 1 : errors / refWords, refStart, refEnd: endI };
}

/** Optimal word alignment (full, non-windowed): for each hypothesis index, the matched reference index or -1. */
export function alignHyp(ref: string[], hyp: string[]): number[] {
  const n = ref.length;
  const m = hyp.length;
  const d: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= n; i++) d[0]![i] = i;
  for (let j = 1; j <= m; j++) {
    d[j]![0] = j;
    for (let i = 1; i <= n; i++) {
      d[j]![i] = Math.min(d[j - 1]![i - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1), d[j]![i - 1]! + 1, d[j - 1]![i]! + 1);
    }
  }
  const map: number[] = Array.from({ length: m }, () => -1);
  let i = n;
  let j = m;
  while (j > 0 && i > 0) {
    const diag = d[j - 1]![i - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
    if (d[j]![i] === diag) {
      map[j - 1] = i - 1;
      i--;
      j--;
    } else if (d[j]![i] === d[j]![i - 1]! + 1) i--;
    else j--;
  }
  return map;
}

export interface SpeakerSeg {
  speaker: string;
  text: string;
}

/**
 * Share of matched words attributed to the right speaker, under the best mapping of hypothesis labels to reference
 * speakers (greedy over label→speaker counts). `turns` is the reference script with speaker names.
 */
export function speakerAccuracy(turns: SpeakerSeg[], segs: SpeakerSeg[]): number | null {
  const ref: string[] = [];
  const refSpk: string[] = [];
  for (const t of turns) for (const w of normalizeText(t.text)) {
      ref.push(w);
      refSpk.push(t.speaker);
    }
  const hyp: string[] = [];
  const hypSpk: string[] = [];
  for (const s of segs) for (const w of normalizeText(s.text)) {
      hyp.push(w);
      hypSpk.push(s.speaker);
    }
  if (!hyp.length) return null;
  const map = alignHyp(ref, hyp);
  const counts = new Map<string, Map<string, number>>();
  let matched = 0;
  map.forEach((ri, hi) => {
    if (ri < 0 || ref[ri] !== hyp[hi]) return;
    matched++;
    const row = counts.get(hypSpk[hi]!) ?? new Map<string, number>();
    row.set(refSpk[ri]!, (row.get(refSpk[ri]!) ?? 0) + 1);
    counts.set(hypSpk[hi]!, row);
  });
  if (!matched) return null;
  // each hypothesis label claims the reference speaker it overlaps most; labels may not share a speaker.
  const taken = new Set<string>();
  let right = 0;
  const pairs = [...counts].flatMap(([h, row]) => [...row].map(([r, c]) => ({ h, r, c }))).toSorted((a, b) => b.c - a.c);
  const used = new Set<string>();
  for (const p of pairs) {
    if (used.has(p.h) || taken.has(p.r)) continue;
    used.add(p.h);
    taken.add(p.r);
    right += p.c;
  }
  return right / matched;
}

export interface DiffOp {
  type: "eq" | "sub" | "del" | "ins";
  ref?: string | undefined;
  hyp?: string | undefined;
}

/** Word-level diff of hypothesis against a reference window, comparing tokens exactly (so case/punctuation show up). */
export function diffTokens(ref: string[], hyp: string[]): DiffOp[] {
  const n = ref.length;
  const m = hyp.length;
  const d: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= n; i++) d[0]![i] = i;
  for (let j = 1; j <= m; j++) {
    d[j]![0] = j;
    for (let i = 1; i <= n; i++) {
      d[j]![i] = Math.min(d[j - 1]![i - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1), d[j]![i - 1]! + 1, d[j - 1]![i]! + 1);
    }
  }
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[j]![i] === d[j - 1]![i - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push(ref[i - 1] === hyp[j - 1] ? { type: "eq", ref: ref[i - 1], hyp: hyp[j - 1] } : { type: "sub", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    } else if (i > 0 && d[j]![i] === d[j]![i - 1]! + 1) {
      ops.push({ type: "del", ref: ref[i - 1] });
      i--;
    } else {
      ops.push({ type: "ins", hyp: hyp[j - 1] });
      j--;
    }
  }
  return ops.toReversed();
}
