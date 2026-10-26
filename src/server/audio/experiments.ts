import type { CompareManifest, CompareSample } from "./compare";

export interface ExperimentVariant {
  key: string;
  /** Column letter shown in the UI and bound to the 1–4 keys. */
  letter: string;
  label: string;
  description: string;
  /** This variant is what the production lane does today. */
  inProduction?: boolean;
}

export interface ExperimentRow {
  key: string;
  label: string;
}

export interface Experiment {
  id: string;
  kind: "question" | "check";
  title: string;
  question: string;
  /** What is held constant, in plain language. */
  same: string;
  /** The one axis that varies. */
  differs: string;
  /** Pick the variant whose ears-verdict answers the question. Checks have none. */
  pickable: boolean;
  /** Variants are listed by letter only; model names and measurements appear on reveal. */
  blind?: boolean;
  variants: ExperimentVariant[];
  rows: ExperimentRow[];
  sampleId: (args: { row: string; variant: string }) => string;
}

const VOICE_ROWS: ExperimentRow[] = [
  { key: "Charon", label: "Charon (male host)" },
  { key: "Erinome", label: "Erinome (female co-host)" },
];

const WRITER_LETTERS = ["A", "B", "C", "D", "E", "F", "G"] as const;
const REMATCH_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

export const EXPERIMENTS: Experiment[] = [
  {
    id: "expression",
    kind: "question",
    title: "Expressiveness",
    question:
      "Does deliberate expression (inline tags, per-turn delivery) make the voice better in every lane — podcast, briefing, chat — or does it sound staged?",
    same: "voices, the words (a finished script; the briefing and chat text are identical across versions), model (gemini-3.8-flash-tts, chat on flash-lite)",
    differs:
      "the expression layer: flat (constant style, no tags — what the lanes did), tags only (a few well-placed pauses/reactions), tags + per-turn delivery (the vocabulary style chosen where the moment changes). Letters are shuffled per row; briefing and chat have flat vs tags + delivery only",
    pickable: true,
    blind: true,
    variants: [
      { key: "a", letter: "A", label: "Version A", description: "" },
      { key: "b", letter: "B", label: "Version B", description: "" },
      { key: "c", letter: "C", label: "Version C", description: "" },
    ],
    rows: [
      { key: "podcast", label: "Podcast — the segment around the DBOS question (three versions)" },
      { key: "briefing", label: "Briefing — a morning briefing through the prep (two versions)" },
      { key: "chat", label: "Chat — a short answer, plain vs written with tags + a delivery (two versions)" },
    ],
    sampleId: ({ row, variant }) => `expr__${row}__${variant}`,
  },
  {
    id: "writer-improved",
    kind: "question",
    title: "Podcast writer — improved pipeline",
    question:
      "Does the improved pipeline (sharing instead of staged argument, names introduced, a lint the reviewers see) sound better with the same writer?",
    same: "writer model, source, show voices; the improved side also has a new editor brief and outline",
    differs: "the pipeline version: bake-off prompts vs improved prompts. Order is shuffled per row",
    pickable: true,
    blind: true,
    variants: [
      { key: "a", letter: "A", label: "Version A", description: "" },
      { key: "b", letter: "B", label: "Version B", description: "" },
    ],
    rows: [
      { key: "opus", label: "Claude Opus 5.5 — the segment around the DBOS question" },
      { key: "sol", label: "GPT-6 Sol — the segment around the DBOS question" },
    ],
    sampleId: ({ row, variant }) => `writerimp__${row}__${variant}`,
  },
  {
    id: "writer-rematch",
    kind: "question",
    title: "Podcast writer — rematch",
    question:
      "Which IU-only writer should voice the podcast now that expression, context and prompts are fixed? Five candidates (Opus and Argon were ruled out on price before listening) — listen blind, pick the one you would put on the drive; the reveal shows model, cost per episode and script stats.",
    same: "research dossier with glossary, fresh frozen outline, editor brief, show bible, production reviewer panel, tightening pass, expressive synth (tags + per-turn delivery), voices (Gemini 3.8, Charon + Erinome)",
    differs:
      "the voice-owning writer model (draft and revision). Grok, GLM, Kimi, Opus-agentic, Argon and the Opus hybrid are out (owner verdicts 2026-10-26)",
    pickable: true,
    blind: true,
    variants: REMATCH_LETTERS.map((letter) => ({
      key: letter.toLowerCase(),
      letter,
      label: `Writer ${letter}`,
      description: "",
    })),
    rows: [
      { key: "opening", label: "Opening segment" },
      { key: "interaction", label: "Most host interaction (the DBOS story)" },
    ],
    sampleId: ({ row, variant }) => `writerrematch__${row}__${variant}`,
  },
  {
    id: "writer",
    kind: "question",
    title: "Podcast writer",
    question:
      "Which model should write the podcast dialogue? Listen blind, pick the one you would put on the drive.",
    same: "outline, brief, dossier, show bible, reviewer panel, voices (Gemini 3.8, Charon + Erinome)",
    differs: "the voice-owning writer model (draft and revision)",
    pickable: true,
    blind: true,
    variants: WRITER_LETTERS.map((letter) => ({
      key: letter.toLowerCase(),
      letter,
      label: `Writer ${letter}`,
      description: "",
    })),
    rows: [
      { key: "opening", label: "Opening segment" },
      { key: "interaction", label: "Most host interaction" },
    ],
    sampleId: ({ row, variant }) => `writer__${row}__${variant}`,
  },
  {
    id: "english",
    kind: "question",
    title: "English terms in German speech",
    question:
      "How should English terms (Pull Request, Deployment Pipeline, Claude Code) be handled in German text?",
    same: "model (gemini-3.8-flash-tts), voice, material",
    differs:
      "a style hint to the model, and/or how the writer spells English compounds",
    pickable: true,
    variants: [
      {
        key: "a-plain",
        letter: "A",
        label: "As written",
        description: "Text as written, hyphenated compounds, plain style.",
        inProduction: true,
      },
      {
        key: "b-style",
        letter: "B",
        label: "Style hint",
        description:
          "Style tells the model to pronounce English terms in English.",
      },
      {
        key: "c-rule",
        letter: "C",
        label: "Writer rule",
        description:
          "English compounds written open, no hyphens (Pull Request, Deployment Pipeline).",
      },
      {
        key: "d-rule+style",
        letter: "D",
        label: "Rule + style hint",
        description: "Writer rule and the English-terms style hint together.",
      },
    ],
    rows: VOICE_ROWS,
    sampleId: ({ row, variant }) => `w5__english__${row}__${variant}`,
  },
  {
    id: "numbers",
    kind: "question",
    title: "Numbers and data",
    question:
      "How should dates, prices, percentages and counts be prepared before they reach the voice?",
    same: "model (gemini-3.8-flash-tts), voice, the facts being spoken",
    differs: "how the numbers are written into the text (and one pace hint)",
    pickable: true,
    variants: [
      {
        key: "a-digits-normalized",
        letter: "A",
        label: "Digits, normalised",
        description: "Digits kept; € → Euro, % → Prozent.",
      },
      {
        key: "b-spelled",
        letter: "B",
        label: "Spelled out",
        description: "Every number written as words.",
        inProduction: true,
      },
      {
        key: "c-spelled-slow",
        letter: "C",
        label: "Spelled out, slow",
        description: "Same as B with the style “speaking slowly and clearly”.",
      },
      {
        key: "d-rounded",
        letter: "D",
        label: "Rounded and spelled",
        description:
          "Statistics rounded (“rund dreizehnhundert Euro”, “Mitte November”).",
        inProduction: true,
      },
    ],
    rows: VOICE_ROWS,
    sampleId: ({ row, variant }) => `w5__numbers__${row}__${variant}`,
  },
  {
    id: "chunks",
    kind: "check",
    title: "Chunk length",
    question: "Does quality drift at the end of long requests?",
    same: "model, voices, material",
    differs:
      "characters sent per request (long material is split at that size and joined)",
    pickable: false,
    variants: [
      {
        key: "1000",
        letter: "A",
        label: "1,000 chars",
        description: "Production briefing chunks are ~1,100.",
        inProduction: true,
      },
      { key: "1500", letter: "B", label: "1,500 chars", description: "" },
      { key: "2000", letter: "C", label: "2,000 chars", description: "" },
      {
        key: "3000",
        letter: "D",
        label: "3,000 chars",
        description: "Production podcast multi-speaker runs go up to 3,000.",
        inProduction: true,
      },
    ],
    rows: [
      { key: "mono", label: "Briefing (one speaker)" },
      { key: "duo", label: "Podcast (two hosts)" },
    ],
    sampleId: ({ row, variant }) => `w5__chunks__${row}-${variant}`,
  },
];

export interface ExperimentView {
  experiment: Experiment;
  rows: {
    row: ExperimentRow;
    cells: Record<string, CompareSample | undefined>;
  }[];
  /** Distinct input texts, each with the variants that sent it. Only for variants with a text in `request`. */
  texts: { text: string; variantKeys: string[] }[];
}

function requestText(sample: CompareSample): string | null {
  if (!sample.request) return null;
  try {
    const parsed: unknown = JSON.parse(sample.request);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "text" in parsed &&
      typeof parsed.text === "string"
    ) {
      return parsed.text;
    }
  } catch {
    // request is free-form for older samples
  }
  return null;
}

export function resolveExperiments(
  manifest: CompareManifest,
): ExperimentView[] {
  const byId = new Map(manifest.samples.map((s) => [s.id, s]));
  return EXPERIMENTS.map((experiment) => {
    const rows = experiment.rows.map((row) => ({
      row,
      cells: Object.fromEntries(
        experiment.variants.map((v) => [
          v.key,
          byId.get(experiment.sampleId({ row: row.key, variant: v.key })),
        ]),
      ),
    }));
    // The text per variant is identical across voices; read it from the first row that has it.
    const textByVariant = new Map<string, string>();
    for (const { cells } of rows) {
      for (const v of experiment.variants) {
        const sample = cells[v.key];
        const text = sample && requestText(sample);
        if (text && !textByVariant.has(v.key)) textByVariant.set(v.key, text);
      }
    }
    const texts: ExperimentView["texts"] = [];
    for (const v of experiment.variants) {
      const text = textByVariant.get(v.key);
      if (!text) continue;
      const existing = texts.find((t) => t.text === text);
      if (existing) existing.variantKeys.push(v.key);
      else texts.push({ text, variantKeys: [v.key] });
    }
    return { experiment, rows, texts };
  });
}
