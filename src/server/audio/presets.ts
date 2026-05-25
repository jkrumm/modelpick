// TTS demo presets — pure data, no server/runtime imports so both the route
// (-audio-server-fns) and the seed script can share one source of truth.
//
// Two independent dimensions, so the playground can compare them separately:
//   1. PRESET  — what is said + how (text + natural-language `style` directive +
//                inline expression tags like [pause], [chuckles]).
//   2. VOICE   — the Gemini prebuilt voice (timbre/speaker). See TTS_CANDIDATE_VOICES.
//
// `style` is prepended to the text on Gemini (the model obeys it). OpenAI-route
// models ignore `style` and read `text` literally.
//
// Inline expression tags ([pause], [chuckles], [sigh], [thoughtful], …) are spoken
// as performance cues by Gemini TTS. They are intentionally shown in the demo text
// so the effect is visible next to the audio. The flat `standard` preset has none
// (it is the literal baseline, also used for the OpenAI cross-provider reference).

export type Lang = "de" | "en";

export type PresetCategory = "standard" | "expressive" | "podcast" | "briefing" | "alert";

export interface TtsPreset {
  id: string;
  lang: Lang;
  preset: PresetCategory;
  /** Delivery directive (Gemini). Omit for a flat, literal read. */
  style?: string;
  text: string;
}

export interface CandidateVoice {
  /** Gemini prebuilt voice name. */
  name: string;
  /** Google's character descriptor. */
  character: string;
}

/** Calm, adult-MALE Gemini voices with a pleasant medium pitch — the candidates
 *  for the Hermes narrator persona. Excludes female voices and the high-energy
 *  / gravelly males (Fenrir, Puck, Algenib, Zubenelgenubi, Sadachbia) and the two
 *  voices already rejected (Orus, Schedar). */
export const TTS_CANDIDATE_VOICES: readonly CandidateVoice[] = [
  { name: "Charon", character: "Informative" },
  { name: "Iapetus", character: "Clear" },
  { name: "Algieba", character: "Smooth" },
  { name: "Rasalgethi", character: "Informative" },
  { name: "Sadaltager", character: "Knowledgeable" },
  { name: "Achird", character: "Friendly" },
  { name: "Umbriel", character: "Easy-going" },
];

export const TTS_PRESETS: readonly TtsPreset[] = [
  // Flat, literal read — the neutral baseline. No style, no inline tags.
  {
    id: "en-standard",
    lang: "en",
    preset: "standard",
    text: "The quick brown fox jumps over the lazy dog. This sentence shows the natural quality of the synthesized voice. Listen to the rhythm, the breathing, and how it handles everyday punctuation across a longer passage.",
  },
  {
    id: "de-standard",
    lang: "de",
    preset: "standard",
    text: "Der schnelle braune Fuchs springt über den faulen Hund. Dieser Satz zeigt die natürliche Qualität der synthetisierten Stimme. Achte auf den Rhythmus, das Atmen und darauf, wie die Stimme über einen längeren Abschnitt mit ganz normaler Zeichensetzung umgeht.",
  },

  // Bright, excited delivery — with inline cues for emphasis and a beat.
  {
    id: "en-expressive",
    lang: "en",
    preset: "expressive",
    style: "Say this with bright, genuine excitement",
    text: "Oh wow — [excited] I genuinely cannot believe how natural and expressive this has become! [pause] We tested it back in spring and it was nowhere near this good. [chuckles] Honestly, it's a little uncanny.",
  },
  {
    id: "de-expressive",
    lang: "de",
    preset: "expressive",
    style: "Sprich das mit echter, lebhafter Begeisterung",
    text: "Oh wow — [begeistert] ich kann kaum fassen, wie natürlich und ausdrucksstark das geworden ist! [pause] Im Frühjahr haben wir das getestet, und da war es noch lange nicht so gut. [lacht] Ehrlich gesagt ist es ein bisschen unheimlich.",
  },

  // Upbeat, conversational podcast host — warm open with a relaxed aside.
  {
    id: "en-podcast",
    lang: "en",
    preset: "podcast",
    style: "Read as an upbeat, warm podcast host opening an episode — conversational and engaging",
    text: "Welcome back to the show. [pause] Today we're digging into the models that actually shipped this year — and a couple that caught everyone off guard. Grab a coffee, get comfortable, [chuckles] because this one's going to be a good one. Let's get into it.",
  },
  {
    id: "de-podcast",
    lang: "de",
    preset: "podcast",
    style:
      "Sprich als gut gelaunter, warmer Podcast-Host zu Beginn einer Folge — locker und mitreißend",
    text: "Willkommen zurück. [pause] Heute geht es um die Modelle, die dieses Jahr wirklich geliefert haben — und ein paar, die alle überrascht haben. Schnapp dir einen Kaffee, mach es dir bequem, [lacht] denn diese Folge wird richtig gut. Legen wir los.",
  },

  // Warm, calm morning briefing (the Hermes persona — no greeting, natural pacing).
  {
    id: "en-briefing",
    lang: "en",
    preset: "briefing",
    style: "Read as a warm, calm narrator giving a morning briefing — no greeting, natural pacing",
    text: "Three meetings today, the first at quarter past nine. [pause] Infrastructure is green, and last night's deploy went through cleanly. Recovery looks solid after yesterday's session, so there's room to push a little. [thoughtful] One thing worth your attention: the invoice from Tuesday is still unpaid.",
  },
  {
    id: "de-briefing",
    lang: "de",
    preset: "briefing",
    style:
      "Lies als warmer, ruhiger Erzähler bei einem Morgen-Briefing — ohne Begrüßung, natürliches Tempo",
    text: "Heute drei Termine, der erste um Viertel nach neun. [pause] Die Infrastruktur ist grün, und das Deployment von gestern Nacht ist sauber durchgelaufen. Die Erholung sieht gut aus nach der gestrigen Einheit, du kannst also ruhig etwas mehr geben. [nachdenklich] Eine Sache noch: Die Rechnung von Dienstag ist weiterhin offen.",
  },

  // Calm but assertive alert — urgent without panic, with a steadying beat.
  {
    id: "en-alert",
    lang: "en",
    preset: "alert",
    style: "Read in a calm but firm, assertive tone — clear and controlled, urgent without panic",
    text: "Heads up: the production database is at ninety percent capacity. [pause] Act now and clear space before it fills. If it reaches one hundred percent, writes will start failing and the API goes down with it. [firm] This is your window — handle it in the next few minutes.",
  },
  {
    id: "de-alert",
    lang: "de",
    preset: "alert",
    style:
      "Sprich in einem ruhigen, aber bestimmten, klaren Ton — kontrolliert, dringlich ohne Panik",
    text: "Achtung: Die Produktionsdatenbank ist zu neunzig Prozent ausgelastet. [pause] Handle jetzt und schaffe Platz, bevor sie voll ist. Wenn sie hundert Prozent erreicht, schlagen Schreibvorgänge fehl, und die API geht mit ihr unter. [bestimmt] Das ist dein Zeitfenster — kümmere dich in den nächsten Minuten darum.",
  },
];
