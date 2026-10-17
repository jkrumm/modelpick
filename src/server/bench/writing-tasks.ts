/**
 * The bench-writing task registry and rubric — six of the owner's real
 * communication jobs, each handed to the model as raw facts so it writes from
 * material rather than invention. Pure data plus two prompt builders; no DB, no
 * fs, no clock. Judging and linting live in writing-metrics.ts, the orchestrator
 * in scripts/bench-writing.ts.
 *
 * Every candidate also receives the owner's voice guide (brain/voice.md) as its
 * system prompt, so a task instruction only has to name register, language and
 * format — the voice rules themselves are not repeated here.
 */

export type TaskLanguage = "en" | "de";
export type TaskRegister = "peer-technical" | "broad" | "personal";

export interface WritingTask {
  id: string;
  /** One-line description for plan output and reports. */
  title: string;
  language: TaskLanguage;
  register: TaskRegister;
  /** What to write, for whom, in which format. */
  instruction: string;
  /** The raw material. The only source of facts the model may use. */
  facts: string;
}

// ── rubric ───────────────────────────────────────────────────────────────────

export interface RubricCriterion {
  id: string;
  label: string;
  /** What a 5 looks like, in one sentence — shown to the judges verbatim. */
  description: string;
}

/** Judges score every criterion 1-5 with a one-line reason. */
export const RUBRIC: readonly RubricCriterion[] = [
  {
    id: "verdict_first",
    label: "Verdict first",
    description: "The claim or answer sits in the first sentence; the reader knows the position before the first paragraph ends.",
  },
  {
    id: "structure",
    label: "Structure",
    description: "Enumerable content is bullets or a table, reasoning is prose, and the whole is scannable at a glance.",
  },
  {
    id: "no_repetition",
    label: "No repetition",
    description: "Each point is made exactly once, in the right place; no restating, no closing summary of what was just said.",
  },
  {
    id: "concision",
    label: "Concision",
    description: "No filler, hedges, signposts or throat-clearing; every sentence carries information.",
  },
  {
    id: "precision",
    label: "Precision",
    description: "Concrete numbers, names and versions from the facts instead of adjectives; nothing invented beyond the facts.",
  },
  {
    id: "clarity",
    label: "Clarity",
    description: "High-level but low cognitive load: short sentences, no nested clauses, nothing that overwhelms.",
  },
  {
    id: "visual_fit",
    label: "Visual fit",
    description: "Uses or proposes a table, diagram, code block or image where it would carry the idea better than prose; does not force one where prose is right.",
  },
  {
    id: "naturalness",
    label: "Naturalness",
    description: "Reads like a person wrote it: no AI-isms, no negative parallelisms, no rule-of-three padding. In German: English tech terms kept, no Nominalstil, no Passivketten.",
  },
  {
    id: "engagement",
    label: "Engagement",
    description: "Interesting and fun to read; a dry aside or a sharp example where it earns its place, never forced.",
  },
];

// ── tasks ────────────────────────────────────────────────────────────────────

const DE_TECH_FACTS = [
  "Notizen zu modelpick (lokales Tool, ein Nutzer, kein Production-Dienst):",
  "",
  "- modelpick läuft als macOS LaunchAgent auf dem Mac mini (Port 7727), nicht als Docker-Container. Bewusst, anders als rb und linewatch.",
  "- rb und linewatch besitzen ihre SQLite-Datei exklusiv. modelpick nicht: dieselbe Datei `modelpick.db` wird auch von Host-Prozessen beschrieben, die sich nicht containerisieren lassen.",
  "- Host-Writer 1: `bun run bench` startet die `claude` CLI als Subprozess und liest den macOS Keychain. Beides gibt es in einem Linux-Container nicht.",
  "- Host-Writer 2: der Refresh-Agent läuft täglich um 06:00 (eigener LaunchAgent) und schreibt in dieselbe Datei.",
  "- Option Docker Volume: zwei Datenbanken, die auseinanderlaufen (eine im Container, eine auf dem Host). Verworfen.",
  "- Option Bind Mount: SQLite auf einem Bind Mount über virtiofs hat zweimal zu Korruption geführt, gemessen: linewatch am 2026-07-30, das Work Dashboard am 2026-07-21 und 2026-07-26. fcntl-Locking funktioniert über die VM-Grenze nicht zuverlässig.",
  "- Prozesse auf demselben Host bekommen echtes SQLite-Locking. Eine VM-Grenze nicht. Das ist der Kern der Entscheidung.",
  "- Secrets: kein Klartext-.env. `secrets-run run --env-file=.env.tpl` löst die `op://`-Referenzen auf. Ein rohes `op run` hängt auf dem Mini, weil `op` dort nicht interaktiv eingeloggt ist.",
  "- Deploy: `make deploy` baut und lädt den LaunchAgent. Bekannte Falle: bootout gefolgt von bootstrap kann mit I/O error 5 scheitern und lässt :7727 down. Dann bootstrap erneut versuchen, oder `make web-restart` nehmen (rebuild plus kickstart, ohne die plist neu zu rendern).",
  "- Health: `make verify` ruft `http://localhost:7727/stack` ab und prüft den gerenderten Body, weil ein vergessener `vite dev` auf 7727 ebenfalls 200 liefert.",
].join("\n");

const EN_ARTICLE_FACTS = [
  "Bullet notes for the section \"Why ccbench is an operational gate, not a quality benchmark\":",
  "",
  "- ccbench = modelpick's agentic benchmark. Each run copies a committed fixture into a throwaway sandbox, spawns `claude -p` against the IU Anthropic route with the model pinned on all four ANTHROPIC_DEFAULT_* tiers, parses the stream-json transcript, grades the resulting files mechanically.",
  "- What it measures: does the model drive an agent loop at all, how fast, at what real cost, how its prompt caching behaves, where it times out.",
  "- Current field: 13 models. 11 of 13 score a flat 1.000. That is the correct answer to \"can it hold a loop\" and no answer at all to \"which is smarter\".",
  "- Used as a ranking, it hands the pick to whatever tiebreak is left over (cost, latency), because the score itself does not separate anyone. Used as a gate, it does exactly the job it was built for: keep out models that cannot hold a loop.",
  "- Quality comes from external leaderboards (OpenRouter, ArtificialAnalysis, Epoch AI, LMArena) in `metric_snapshot`. Never from ccbench.",
  "- Why it still exists: leaderboard scores say nothing about whether a model survives a tool loop, how it caches, or where it times out. Only a real agent loop shows that.",
  "- It spends real money: `--yes` required non-interactively, `--dry-run` costs nothing. Example: the leaderboard index alone picked claude-fable-5-1 for the orchestrator slot; a 130-session ccbench run found the field saturated at 1.00 and claude-fable-5 the most expensive way to buy that identical score, so the measurement replaced the leaderboard inputs for that category.",
  "- Sharp edge: the sandbox needs its own isolated CLAUDE_CONFIG_DIR. Without it the run loads the global CLAUDE.md, MCP servers and hooks, and the benchmark measures the dotfiles instead of the model.",
  "- Other readers of the data: `bun run cap` and the /bench route share one derivation, so they cannot disagree. Output: three picks (interactive, unattended worker, EU-pinned).",
].join("\n");

const LANDING_FACTS = [
  "Product: free-planning-poker (website for agile teams to estimate stories together).",
  "",
  "- Estimates are anonymous and revealed together, all at once, only when the host flips the cards.",
  "- Why it matters: nobody anchors on the senior dev's number. A 3 next to a 13 shows two people hold different pictures of the work, and the talk that follows is worth more than the final number.",
  "- No accounts, no sign-up, no email, no pricing page. Free.",
  "- Open a room, share the link, estimate. A room opens in one click; teammates join from the link in a browser, no install.",
  "- Works on phones, so remote and hybrid teams can join from anywhere.",
  "- Card decks: Fibonacci (0, 1, 2, 3, 5, 8, 13, 21), T-shirt sizes (XS to XL), and a custom deck.",
  "- Rooms disappear after 24 hours of inactivity; nothing is stored about the people in them.",
  "- Audience: product owners, scrum masters, developers, and managers who have never run a planning session and just need a number everyone agrees on.",
  "- Output wanted: hero headline, one-sentence subline, one call-to-action label, then exactly three benefits (short title plus one or two sentences each).",
].join("\n");

const UI_COPY_FACTS = [
  "Screen: \"Join a room\" in free-planning-poker. The user pastes or types a 6-character room code (letters and digits, case-insensitive) or arrives via a shared link, enters a display name, and joins.",
  "",
  "- Empty state: the lobby of a freshly opened room, before anyone else has joined. The host is alone. The share link is the main action; copying it puts it on the clipboard.",
  "- Join can fail for exactly three reasons, and the error should name the actual one when known: the room code does not exist (typo), the room expired (rooms close after 24 hours of inactivity), or the room is full (the limit is 12 people).",
  "- For this task: write one error message for the failed join where the cause is unknown (network or server), with a clear next step. Assume a retry usually works.",
  "- Primary actions on the screen: join the room, create a new room instead, and go back to the start page. Three button labels, one per action.",
  "- Tooltip: on the display-name field, explaining that the name is shown to the other people in the room and is not stored after the room closes.",
  "- Tone: plain, friendly, no exclamation marks, no apology theatre. Strings are short; they must fit on a phone.",
  "- Output format: a labeled list, one line per string, exactly these labels: EMPTY_STATE_TITLE, EMPTY_STATE_BODY, JOIN_ERROR, BUTTON_JOIN, BUTTON_CREATE, BUTTON_BACK, TOOLTIP_NAME.",
].join("\n");

const REWRITE_PARAGRAPH = [
  "When it comes to the question of how much thinking a reasoning model should be allowed to do, it is important to understand that thinking is not merely an overhead cost to be minimized, it is in fact the very lever through which quality is ultimately obtained, and this is something that the measurements consistently reveal, since a model such as Luna, which scores 16.8 when thinking is switched off entirely, climbs all the way to 37.5 once the effort is set to its maximum, which is to say that the thinking is not a tax on the answer, it is the answer itself in the making.",
  "",
  "That said, the lever only works if the budget allows it to, because a model that has been given too small a token budget will happily spend all of it on hidden reasoning and then return an HTTP 200 with empty content and a finish reason of length, and this silent failure, which looks like success to any caller that does not inspect the finish reason, is not a sign that the model is bad, it is a sign that the budget was too small, so the budget must be raised before the effort is ever lowered, and it should be remembered that budget that goes unused is not billed, so being generous costs nothing, and generosity with the budget is therefore the safe and sensible default in every case.",
  "",
  "Finally, and this is the part that is most easily forgotten, the effort should always be set explicitly rather than left to the default, because glm-5.3-flash, for example, defaults to max, which is not the best setting for it but its worst, so the default is not a neutral choice, it is a choice somebody else made for you, and it is a choice that can be wrong.",
].join("\n");

const REWRITE_FACTS = [
  "Original paragraph (the text to rewrite; it is the only source of facts):",
  "",
  REWRITE_PARAGRAPH,
].join("\n");

const DE_BRIEFING_FACTS = [
  "Rohdaten von heute (Samstag), vom Agenten gesammelt:",
  "",
  "Training",
  "- Kreuzheben: 3x5 @ 150 kg, alle Sätze sauber, RPE 8. Letzte Woche 3x5 @ 145 kg. Geschätztes 1RM: 185 kg (vor vier Wochen: 180 kg).",
  "- Kniebeuge ausgelassen. Knie meldet sich nach tiefen Beugen, seit zwei Wochen keine Tiefenarbeit mehr, Schmerz 0/10 beim Gehen.",
  "- Schlaf letzte Nacht: 6 h 40, Ruhepuls 54 (Schnitt der letzten 30 Tage: 52).",
  "- Geplant für morgen: Ruhetag, 40 min locker Zone 2 laufen.",
  "",
  "Server",
  "- Mini: Platte bei 87 % belegt (vor einer Woche 81 %). Größter Block: Docker-Images und Build-Cache, 212 GB von 460 GB gesamt. Ab 90 % schlagen die Backups fehl.",
  "- VPS: Platte 41 %, RAM 63 %, alles grün.",
  "",
  "Cron",
  "- `morning-briefing` (07:00) ist heute fehlgeschlagen: Timeout nach 600 s beim Abruf der Kalenderdaten. Gestern lief derselbe Job durch. Erster Fehler in 23 Tagen.",
  "- Alle anderen 11 Jobs grün. Letzter Backup-Lauf: 03:10, 14 GB, ok.",
  "",
  "Lesen",
  "- \"Designing Data-Intensive Applications\": Seite 312 von 612, Kapitel 7 (Transactions) fertig. Letzte Woche Seite 198, also 114 Seiten in 7 Tagen, doppelt so schnell wie der Schnitt.",
  "- Nächstes Kapitel: 8 (The Trouble with Distributed Systems), ca. 40 Seiten.",
  "",
  "Gewünscht: Briefing als Bullet-Liste für den Tag, wichtigstes zuerst, mit ehrlichen Status-Flags (was dringend ist, was beobachtet werden soll).",
].join("\n");

export const WRITING_TASKS: readonly WritingTask[] = [
  {
    id: "de-tech",
    title: "German technical explanation for an Obsidian vault page",
    language: "de",
    register: "peer-technical",
    instruction:
      "Schreibe den Abschnitt einer Obsidian-Wiki-Seite auf Deutsch: Warum läuft modelpick als macOS LaunchAgent und nicht als Docker-Container? Leser sind Entwickler. Englische Tech-Begriffe bleiben englisch. Format: Markdown, eine kurze Überschrift, dann der Text. Nutze ausschließlich die Fakten unten.",
    facts: DE_TECH_FACTS,
  },
  {
    id: "en-article",
    title: "English peer-technical article section from bullet notes",
    language: "en",
    register: "peer-technical",
    instruction:
      "Write one section of a technical article from the bullet notes below. Readers are senior engineers. Give the section a heading. Use only the facts in the notes; do not invent numbers or incidents.",
    facts: EN_ARTICLE_FACTS,
  },
  {
    id: "landing",
    title: "Broad-register landing page hero plus three benefits",
    language: "en",
    register: "broad",
    instruction:
      "Write the hero section and the three-benefit block of the landing page for the product below. Readers are smart but not necessarily developers. Aim at the reader's problem, not their knowledge level. Use only the facts given.",
    facts: LANDING_FACTS,
  },
  {
    id: "ui-copy",
    title: "UI microcopy for one screen, as a labeled list",
    language: "en",
    register: "broad",
    instruction:
      "Write the UI microcopy for the screen described below. Output exactly the labeled list requested, one line per string, nothing else.",
    facts: UI_COPY_FACTS,
  },
  {
    id: "rewrite",
    title: "Rewrite a convoluted AI-style paragraph into clear structured prose",
    language: "en",
    register: "peer-technical",
    instruction:
      "Rewrite the text below for senior engineers. Keep every fact and number, drop everything else. Use structure where the content is enumerable (bullets, a table) and prose where it is reasoning. Say each point once.",
    facts: REWRITE_FACTS,
  },
  {
    id: "de-briefing",
    title: "German personal briefing (bullets) from raw daily data",
    language: "de",
    register: "personal",
    instruction:
      "Schreibe aus den Rohdaten ein persönliches Tagesbriefing auf Deutsch, als Bullet-Liste. Das ist eine Notiz an mich selbst: telegrafisch ist erlaubt, englische Tech-Begriffe bleiben englisch. Nutze nur die Rohdaten.",
    facts: DE_BRIEFING_FACTS,
  },
];

export function getWritingTasks(ids?: string[]): WritingTask[] {
  if (!ids || ids.length === 0) return [...WRITING_TASKS];
  return ids.map((id) => {
    const task = WRITING_TASKS.find((t) => t.id === id);
    if (!task) throw new Error(`unknown task "${id}" — known: ${WRITING_TASKS.map((t) => t.id).join(", ")}`);
    return task;
  });
}

/** What the candidate sees as the user turn (the voice guide is the system turn). */
export function candidatePrompt(task: WritingTask): string {
  return `${task.instruction}\n\n---\n${task.facts}`;
}

// ── judge prompt ─────────────────────────────────────────────────────────────

export const JUDGE_SYSTEM = [
  "You are a strict, independent editor scoring anonymous drafts of the same writing task.",
  "Score each draft on every criterion from 1 (fails) to 5 (excellent), integers only. Use the full range;",
  "a 5 is rare and a 3 is competent. Do not reward length, polish or confidence for its own sake.",
  "Judge against the supplied facts: anything not supported by them is invented and costs precision.",
  "You do not know which model wrote which draft. Reply with one JSON object and nothing else.",
].join(" ");

/** The user turn for one judge: the task, its facts, the rubric, and the
 *  anonymized drafts under neutral labels. */
export function judgePrompt(input: {
  task: WritingTask;
  drafts: ReadonlyArray<{ label: string; text: string }>;
}): string {
  const { task, drafts } = input;
  const rubric = RUBRIC.map((c) => `- ${c.id}: ${c.description}`).join("\n");
  const example = JSON.stringify({
    scores: Object.fromEntries(
      drafts.slice(0, 1).map((d) => [
        d.label,
        Object.fromEntries(RUBRIC.map((c) => [c.id, { score: 3, reason: "one short sentence" }])),
      ]),
    ),
  });
  return [
    `Task language: ${task.language === "de" ? "German" : "English"}. Register: ${task.register}.`,
    "",
    "## The writing task the drafts answer",
    task.instruction,
    "",
    "## The facts the writers were given (their only legitimate source)",
    task.facts,
    "",
    "## Rubric (each criterion, 1-5)",
    rubric,
    "",
    "## Drafts",
    ...drafts.flatMap((d) => [`### Draft ${d.label}`, d.text.trim(), ""]),
    "## Reply format",
    `Return strict JSON, exactly this shape, one entry per draft label (${drafts.map((d) => d.label).join(", ")}) and every criterion id, each with an integer score and a one-line reason:`,
    example,
  ].join("\n");
}
