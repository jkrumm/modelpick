# bench-writing blind read

Outputs are labelled by a per-task shuffle. Read, rank, then open key.json.

## de-tech — German technical explanation for an Obsidian vault page

Task prompt given to every model (system prompt: the voice guide):

> Schreibe den Abschnitt einer Obsidian-Wiki-Seite auf Deutsch: Warum läuft modelpick als macOS LaunchAgent und nicht als Docker-Container? Leser sind Entwickler. Englische Tech-Begriffe bleiben englisch. Format: Markdown, eine kurze Überschrift, dann der Text. Nutze ausschließlich die Fakten unten.
>
> ---
> Notizen zu modelpick (lokales Tool, ein Nutzer, kein Production-Dienst):
>
> - modelpick läuft als macOS LaunchAgent auf dem Mac mini (Port 7727), nicht als Docker-Container. Bewusst, anders als rb und linewatch.
> - rb und linewatch besitzen ihre SQLite-Datei exklusiv. modelpick nicht: dieselbe Datei `modelpick.db` wird auch von Host-Prozessen beschrieben, die sich nicht containerisieren lassen.
> - Host-Writer 1: `bun run bench` startet die `claude` CLI als Subprozess und liest den macOS Keychain. Beides gibt es in einem Linux-Container nicht.
> - Host-Writer 2: der Refresh-Agent läuft täglich um 06:00 (eigener LaunchAgent) und schreibt in dieselbe Datei.
> - Option Docker Volume: zwei Datenbanken, die auseinanderlaufen (eine im Container, eine auf dem Host). Verworfen.
> - Option Bind Mount: SQLite auf einem Bind Mount über virtiofs hat zweimal zu Korruption geführt, gemessen: linewatch am 2026-07-30, das Work Dashboard am 2026-07-21 und 2026-07-26. fcntl-Locking funktioniert über die VM-Grenze nicht zuverlässig.
> - Prozesse auf demselben Host bekommen echtes SQLite-Locking. Eine VM-Grenze nicht. Das ist der Kern der Entscheidung.
> - Secrets: kein Klartext-.env. `secrets-run run --env-file=.env.tpl` löst die `op://`-Referenzen auf. Ein rohes `op run` hängt auf dem Mini, weil `op` dort nicht interaktiv eingeloggt ist.
> - Deploy: `make deploy` baut und lädt den LaunchAgent. Bekannte Falle: bootout gefolgt von bootstrap kann mit I/O error 5 scheitern und lässt :7727 down. Dann bootstrap erneut versuchen, oder `make web-restart` nehmen (rebuild plus kickstart, ohne die plist neu zu rendern).
> - Health: `make verify` ruft `http://localhost:7727/stack` ab und prüft den gerenderten Body, weil ein vergessener `vite dev` auf 7727 ebenfalls 200 liefert.

#### A

## Warum modelpick ein LaunchAgent ist

modelpick läuft als LaunchAgent auf dem Mac mini, nicht als Docker-Container — anders als rb und linewatch. Der Grund ist einer: die SQLite-Datei gehört nicht modelpick allein.

Zwei Host-Prozesse schreiben in dieselbe `modelpick.db`:

- **`bun run bench`** startet die `claude` CLI als Subprozess und liest den macOS Keychain. Beides existiert in einem Linux-Container nicht.
- **Refresh-Agent** (eigener LaunchAgent, 06:00 daily) schreibt ebenfalls direkt in die Datei.

rb und linewatch haben das Problem nicht — ihre SQLite-Datei gehört dem Container exklusiv. Bei modelpick scheidet das aus; beide naheliegenden Docker-Optionen sind kaputt:

| Option | Problem |
|---|---|
| **Docker Volume** | Zwei Datenbanken, die auseinanderlaufen — eine im Container, eine auf dem Host. |
| **Bind Mount** | fcntl-Locking über virtiofs funktioniert nicht zuverlässig. Drei gemessene Korruptionen: linewatch 2026-07-30, Work Dashboard 2026-07-21 und 2026-07-26. |

Prozesse auf demselben Host bekommen echtes SQLite-Locking. Eine VM-Grenze nicht. Damit ist die Entscheidung gefallen.

### Deploy und Betrieb

`make deploy` baut und lädt den LaunchAgent (Port 7727).

- **Bekannte Falle:** `bootout` → `bootstrap` kann mit I/O error 5 scheitern und lässt :7727 down. Fix: bootstrap erneut versuchen, oder `make web-restart` (rebuild + kickstart, ohne die plist neu zu rendern).
- **Secrets:** kein Klartext-`.env`. `secrets-run run --env-file=.env.tpl` löst die `op://`-Referenzen auf. Ein rohes `op run` hängt auf dem Mini, weil `op` dort nicht interaktiv eingeloggt ist.
- **Health:** `make verify` ruft `http://localhost:7727/stack` ab und prüft den gerenderten Body — ein vergessener `vite dev` auf 7727 liefert ebenfalls 200.

#### B

## LaunchAgent statt Docker

`modelpick` läuft auf dem Mac mini (Port 7727) bewusst als macOS LaunchAgent — anders als `rb` und `linewatch`, die als Docker-Container laufen. Der Grund ist SQLite-Locking über die VM-Grenze.

`rb` und `linewatch` besitzen ihre SQLite-Datei exklusiv. `modelpick` nicht: Das Tool ist ein lokaler Single-User-Dienst, dessen `modelpick.db` parallel von zwei Host-Prozessen beschrieben wird, die sich nicht in einen Linux-Container sperren lassen:

- **`bun run bench`:** startet die `claude` CLI als Subprozess und liest den macOS Keychain. Beides existiert in einem Linux-Container nicht.
- **06:00-Refresh-Agent:** läuft täglich als eigener LaunchAgent auf dem Host und schreibt direkt in dieselbe Datenbank.

Damit fällt Docker für den Web-Prozess raus:

- **Docker Volume:** erzeugt zwei getrennte Datenbanken (Container und Host), die auseinanderlaufen.
- **Bind Mount:** `fcntl`-Locking über virtiofs funktioniert über die VM-Grenze nicht zuverlässig. Das hat hier bereits zweimal zu Korruption geführt (`linewatch` am 2026-07-30, Work Dashboard am 2026-07-21 und 2026-07-26).
- **LaunchAgent:** alle Writer laufen auf demselben Host-Kernel und bekommen echtes SQLite-Locking.

Für den Betrieb auf dem Mini heißt das:

- **Secrets:** Keine Klartext-`.env`. `secrets-run run --env-file=.env.tpl` löst die `op://`-Referenzen beim Start auf. Ein direktes `op run` hängt auf dem Mini, weil `op` dort nicht interaktiv eingeloggt ist.
- **Deploy:** `make deploy` baut und lädt den LaunchAgent. Bekannte Falle: `bootout` direkt gefolgt von `bootstrap` schlägt gelegentlich mit `I/O error 5` fehl und lässt `:7727` down. Dann `bootstrap` erneut ausführen oder direkt `make web-restart` nutzen (Rebuild plus `kickstart`, ohne die plist neu zu rendern).
- **Health-Check:** `make verify` ruft `http://localhost:7727/stack` ab und prüft den gerenderten Body — ein reiner Status-Code-Check reicht nicht, weil ein vergessener `vite dev` auf Port 7727 ebenfalls `200` liefert.

#### C

## Warum ein LaunchAgent?

modelpick läuft bewusst als macOS LaunchAgent auf dem Mac mini: Die gemeinsame `modelpick.db` braucht verlässliches SQLite-Locking zwischen Prozessen auf demselben Host. Über die VM-Grenze funktioniert das `fcntl`-Locking nicht zuverlässig.

Anders als rb und linewatch besitzt modelpick seine SQLite-Datei nicht exklusiv. Zwei weitere Host-Prozesse schreiben hinein:

- **Bench:** `bun run bench` startet die `claude` CLI als Subprozess und liest den macOS Keychain. Dieser Ablauf lässt sich nicht in einen Linux-Container verlagern.
- **Refresh:** Ein eigener LaunchAgent aktualisiert die Datenbank täglich um 06:00.

Die beiden Docker-Optionen sind verworfen:

- **Docker Volume:** Container und Host hätten jeweils eine eigene Datenbank. Die Dateien würden auseinanderlaufen.
- **Bind Mount:** SQLite über virtiofs hat bereits zu Korruption geführt — bei linewatch am 2026-07-30 und beim Work Dashboard am 2026-07-21 sowie 2026-07-26.

modelpick ist ein lokales Tool für einen Nutzer, kein Production-Dienst. Für den Betrieb auf Port 7727 gilt:

- **Secrets:** Kein Klartext-`.env`. `secrets-run run --env-file=.env.tpl` löst die `op://`-Referenzen auf. Ein direktes `op run` hängt auf dem Mini, weil `op` dort nicht interaktiv eingeloggt ist.
- **Deploy:** `make deploy` baut und lädt den LaunchAgent. Die Folge `bootout` → `bootstrap` kann mit `I/O error 5` scheitern; Port 7727 bleibt dann down. In diesem Fall `bootstrap` erneut versuchen oder `make web-restart` verwenden. Letzteres führt einen Rebuild plus `kickstart` aus, ohne die plist neu zu rendern.
- **Health:** `make verify` ruft `http://localhost:7727/stack` ab und prüft den gerenderten Body. HTTP 200 allein reicht nicht: Ein vergessener `vite dev` auf Port 7727 liefert ebenfalls 200.

#### D

## Warum LaunchAgent statt Docker

modelpick läuft als macOS LaunchAgent auf dem Mac mini (Port 7727), nicht als Docker-Container wie rb und linewatch. Der Grund ist eine einzige Datei: `modelpick.db`.

rb und linewatch besitzen ihre SQLite-Datei exklusiv. modelpick teilt sie mit zwei Host-Prozessen, die sich nicht containerisieren lassen:

- **`bun run bench`** startet die `claude` CLI als Subprozess und liest den macOS Keychain. Beides gibt es in einem Linux-Container nicht.
- **Refresh-Agent** (eigener LaunchAgent, täglich 06:00) schreibt in dieselbe Datei.

Für einen Container bleiben damit zwei Wege, und beide sind schlecht:

| Option | Problem | Status |
|-|-|-|
| Docker Volume | Zwei Datenbanken — eine im Container, eine auf dem Host — die auseinanderlaufen | verworfen |
| Bind Mount (virtiofs) | fcntl-Locking über die VM-Grenze ist nicht zuverlässig. Gemessen: Korruption bei linewatch (2026-07-30) und beim Work Dashboard (2026-07-21, 2026-07-26) | verworfen |
| LaunchAgent | Alle Writer auf demselben Host | aktiv |

Der Kern der Entscheidung: Prozesse auf demselben Host bekommen echtes SQLite-Locking, eine VM-Grenze nicht. Für ein lokales Tool mit einem Nutzer ist das der ganze Tradeoff.

### Betrieb

- **Secrets:** kein Klartext-`.env`. `secrets-run run --env-file=.env.tpl` löst die `op://`-Referenzen auf. Ein rohes `op run` hängt auf dem Mini — `op` ist dort nicht interaktiv eingeloggt.
- **Deploy:** `make deploy` baut und lädt den LaunchAgent. Bekannte Falle: bootout gefolgt von bootstrap kann mit I/O error 5 scheitern und lässt :7727 down. Dann bootstrap erneut versuchen, oder `make web-restart` nehmen (Rebuild plus kickstart, ohne die plist neu zu rendern).
- **Health:** `make verify` ruft `http://localhost:7727/stack` ab und prüft den gerenderten Body — ein vergessener `vite dev` auf 7727 liefert ebenfalls 200.

#### E

## Warum LaunchAgent statt Docker

modelpick läuft als macOS LaunchAgent auf dem Mac mini (Port 7727), nicht als Docker-Container. Das ist bewusst anders als bei rb und linewatch. Der Grund ist SQLite-Locking: Prozesse auf demselben Host bekommen echtes Locking, über eine VM-Grenze hinweg gibt es das nicht.

rb und linewatch besitzen ihre SQLite-Datei exklusiv. modelpick teilt sich `modelpick.db` mit zwei Writern auf dem Host:

- **`bun run bench`** startet die `claude` CLI als Subprozess und liest den macOS Keychain. Beides fehlt in einem Linux-Container.
- **Refresh-Agent:** ein eigener LaunchAgent, der täglich um 06:00 in dieselbe Datei schreibt.

Keiner der beiden lässt sich containerisieren. Ein Container müsste also auf die Datei des Hosts zugreifen. Dafür gibt es zwei Wege, und beide sind verworfen:

| Option | Problem |
|-|-|
| Docker Volume | Es entstehen zwei Datenbanken, eine im Container und eine auf dem Host. Die laufen auseinander. |
| Bind Mount | fcntl-Locking über virtiofs ist nicht zuverlässig. SQLite ist auf diese Weise schon in zwei Projekten korrumpiert: linewatch am 2026-07-30, das Work Dashboard am 2026-07-21 und am 2026-07-26. |

Übrig bleibt der LaunchAgent. Alle Writer laufen auf einem Host und bekommen echtes Locking. Für ein lokales Tool mit einem Nutzer ist das die richtige Wahl.

**Betrieb**

- **Secrets:** Es gibt keine `.env` im Klartext. `secrets-run run --env-file=.env.tpl` löst die `op://`-Referenzen auf. Ein rohes `op run` hängt auf dem Mini, weil `op` dort nicht interaktiv eingeloggt ist.
- **Deploy:** `make deploy` baut und lädt den LaunchAgent. Bekannte Falle: bootout gefolgt von bootstrap kann mit I/O error 5 scheitern. Danach ist :7727 down. In dem Fall bootstrap erneut versuchen oder `make web-restart` nehmen. Das macht einen Rebuild plus kickstart, ohne die plist neu zu rendern.
- **Health:** `make verify` ruft `http://localhost:7727/stack` ab und prüft den gerenderten Body. Ein reiner Statuscheck reicht nicht, denn ein vergessener `vite dev` auf 7727 liefert ebenfalls 200.

---

## en-article — English peer-technical article section from bullet notes

Task prompt given to every model (system prompt: the voice guide):

> Write one section of a technical article from the bullet notes below. Readers are senior engineers. Give the section a heading. Use only the facts in the notes; do not invent numbers or incidents.
>
> ---
> Bullet notes for the section "Why ccbench is an operational gate, not a quality benchmark":
>
> - ccbench = modelpick's agentic benchmark. Each run copies a committed fixture into a throwaway sandbox, spawns `claude -p` against the IU Anthropic route with the model pinned on all four ANTHROPIC_DEFAULT_* tiers, parses the stream-json transcript, grades the resulting files mechanically.
> - What it measures: does the model drive an agent loop at all, how fast, at what real cost, how its prompt caching behaves, where it times out.
> - Current field: 13 models. 11 of 13 score a flat 1.000. That is the correct answer to "can it hold a loop" and no answer at all to "which is smarter".
> - Used as a ranking, it hands the pick to whatever tiebreak is left over (cost, latency), because the score itself does not separate anyone. Used as a gate, it does exactly the job it was built for: keep out models that cannot hold a loop.
> - Quality comes from external leaderboards (OpenRouter, ArtificialAnalysis, Epoch AI, LMArena) in `metric_snapshot`. Never from ccbench.
> - Why it still exists: leaderboard scores say nothing about whether a model survives a tool loop, how it caches, or where it times out. Only a real agent loop shows that.
> - It spends real money: `--yes` required non-interactively, `--dry-run` costs nothing. Example: the leaderboard index alone picked claude-fable-5-1 for the orchestrator slot; a 130-session ccbench run found the field saturated at 1.00 and claude-fable-5 the most expensive way to buy that identical score, so the measurement replaced the leaderboard inputs for that category.
> - Sharp edge: the sandbox needs its own isolated CLAUDE_CONFIG_DIR. Without it the run loads the global CLAUDE.md, MCP servers and hooks, and the benchmark measures the dotfiles instead of the model.
> - Other readers of the data: `bun run cap` and the /bench route share one derivation, so they cannot disagree. Output: three picks (interactive, unattended worker, EU-pinned).

#### A

## Why ccbench is an operational gate, not a quality benchmark

ccbench answers one question: can this model hold an agent loop? It can't tell you which model is smarter. Read its score as a ranking and the decision quietly moves to whatever tiebreak is left over.

The mechanics set the scope. Each run copies a committed fixture into a throwaway sandbox and spawns `claude -p` against the IU Anthropic route, with the model pinned on all four `ANTHROPIC_DEFAULT_*` tiers. It then parses the stream-json transcript and grades the resulting files mechanically. That measures five things:

- **Viability:** does the model drive the loop at all.
- **Speed:** how fast it gets through.
- **Cost:** what the run really costs.
- **Caching:** how its prompt caching behaves.
- **Timeouts:** where it stalls out.

The current field is 13 models, and 11 of them score a flat 1.000. That's the correct answer to "can it hold a loop" and no answer at all to "which is smarter." As a ranking, the score separates nobody, so cost or latency ends up picking the winner. As a gate, it does exactly the job it was built for: keeping out models that can't hold a loop.

Quality comes from external leaderboards, snapshotted in `metric_snapshot`: OpenRouter, ArtificialAnalysis, Epoch AI and LMArena. It never comes from ccbench. The benchmark still earns its place because those leaderboards are blind to everything above. None of them shows whether a model survives a tool loop, how it caches or where it times out. Only a real agent loop does.

The orchestrator slot shows the split in practice. The leaderboard index alone picked claude-fable-5-1. A 130-session ccbench run then found the field saturated at 1.00, with claude-fable-5 the most expensive way to buy that identical score. For that category, the measurement replaced the leaderboard inputs.

Two operating notes:

- **It spends real money.** Non-interactive runs require `--yes`. `--dry-run` costs nothing.
- **Isolate the config dir.** The sandbox needs its own `CLAUDE_CONFIG_DIR`. Without it, the run loads the global CLAUDE.md, MCP servers and hooks, and the benchmark measures your dotfiles instead of the model.

Downstream, `bun run cap` and the `/bench` route share one derivation, so they can't disagree. Together they produce three picks: interactive, unattended worker and EU-pinned.

---

*Check before publishing:* the notes name claude-fable-5-1 as the leaderboard pick but claude-fable-5 as the most expensive in the run. I kept both names as written. If they're the same model, align them, or the example reads as comparing two different things.

#### B

## Why ccbench is an operational gate, not a quality benchmark

ccbench is modelpick's agentic benchmark, and 11 of its 13 models score a flat 1.000. That is not a broken scale. It is the correct answer to the only question the benchmark asks — can this model hold an agent loop — and no answer at all to "which one is smarter".

Each run copies a committed fixture into a throwaway sandbox, spawns `claude -p` against the IU Anthropic route with the model pinned on all four `ANTHROPIC_DEFAULT_*` tiers, parses the stream-json transcript and grades the resulting files mechanically. What falls out:

- **Loop survival:** does the model drive an agent loop at all.
- **Speed:** how fast.
- **Cost:** what the run actually spent.
- **Caching:** how prompt caching behaves across the loop.
- **Timeouts:** where it stops responding.

Quality is not on that list. It comes from the external leaderboards — OpenRouter, ArtificialAnalysis, Epoch AI, LMArena — stored in `metric_snapshot`. Never from ccbench.

The two readings of the same score pull in opposite directions. Used as a ranking, ccbench hands the pick to whatever tiebreak is left over — cost, latency — because a score that doesn't separate 11 of 13 candidates can't order them. Used as a gate, it does exactly the job it was built for: keep out the models that cannot hold a loop.

So why keep it, if the leaderboards own quality? Because a leaderboard score says nothing about whether a model survives a tool loop, how it caches, or where it times out. Only a real agent loop shows that — which is also why ccbench spends real money. Non-interactive runs require `--yes`; `--dry-run` costs nothing. The spend has paid for itself at least once: the leaderboard index alone picked claude-fable-5-1 for the orchestrator slot. A 130-session ccbench run found the field saturated at 1.00 and claude-fable-5 the most expensive way to buy that identical score. The measurement replaced the leaderboard inputs for that category.

One sharp edge. The sandbox needs its own isolated `CLAUDE_CONFIG_DIR`. Without it the run loads the global CLAUDE.md, MCP servers and hooks — and the benchmark measures the dotfiles instead of the model.

The data has two other readers, `bun run cap` and the /bench route. They share one derivation, so they cannot disagree. Output is three picks: interactive, unattended worker, EU-pinned.

#### C

## ccbench is an operational gate

ccbench, modelpick’s agentic benchmark, excludes models that cannot hold an agent loop. Its current field makes the boundary clear: 11 of 13 models score a flat 1.000. That answers “can it hold a loop?” and says nothing about which model is smarter.

Each run:

1. Copies a committed fixture into a throwaway sandbox.
2. Spawns `claude -p` against the IU Anthropic route, with the model pinned on all four `ANTHROPIC_DEFAULT_*` tiers.
3. Parses the stream-json transcript.
4. Grades the resulting files mechanically.

The run also exposes speed, real cost, prompt-cache behavior and timeouts. Leaderboard scores cannot establish those operational properties; they require a real agent loop.

Used as a ranking, the saturated score hands the decision to whichever tiebreak remains: cost or latency. Quality comes from OpenRouter, ArtificialAnalysis, Epoch AI and LMArena, stored in `metric_snapshot`. ccbench never supplies that quality signal.

The leaderboard index alone picked `claude-fable-5-1` for the orchestrator slot. A 130-session ccbench run found the field saturated at 1.00 and `claude-fable-5` the most expensive way to buy that identical score. That measurement replaced the leaderboard inputs for that category.

Two operational constraints matter:

- **Spend:** Runs cost real money. Non-interactive execution requires `--yes`; `--dry-run` costs nothing.
- **Isolation:** The sandbox needs its own `CLAUDE_CONFIG_DIR`. Without it, the run loads the global `CLAUDE.md`, MCP servers and hooks. The benchmark then measures the dotfiles instead of the model.

`bun run cap` and the `/bench` route share one derivation, so they cannot disagree. Both produce three picks: interactive, unattended worker and EU-pinned.

#### D

## Why ccbench is an operational gate, not a quality benchmark

`ccbench` is `modelpick`'s agentic benchmark, and its job is to filter out models that break in a tool loop — never to rank intelligence. In the current field of 13 models, 11 score a flat 1.000. That is the right answer to "can it hold a loop" and no answer at all to "which is smarter". Used as a ranking, a saturated score hands the pick to whatever cost or latency tiebreak is left over, because the score itself separates nobody. Used as a gate, it does the exact job it was built for: keep out models that cannot hold a loop, and leave quality grading to the external leaderboards (OpenRouter, ArtificialAnalysis, Epoch AI, and LMArena) in `metric_snapshot`.

Leaderboards still need `ccbench` in front of them because static scores say nothing about whether a model survives a tool loop, how fast it finishes, what it costs in practice, how its prompt caching behaves, or where it times out. Only a real agent loop shows that. Each run copies a committed fixture into a throwaway sandbox, spawns `claude -p` against the IU Anthropic route with the model pinned on all four `ANTHROPIC_DEFAULT_*` tiers, parses the `stream-json` transcript, and grades the resulting files mechanically. The sandbox needs its own isolated `CLAUDE_CONFIG_DIR` — without it, the run loads the global `CLAUDE.md`, MCP servers, and hooks, and the benchmark measures the dotfiles instead of the model.

Running that loop spends real money (`--dry-run` costs nothing; non-interactive runs require `--yes`). When the leaderboard index alone picked `claude-fable-5-1` for the orchestrator slot, a 130-session `ccbench` run found the field saturated at 1.00 and `claude-fable-5` the most expensive way to buy that identical score, so the measurement replaced the leaderboard inputs for that category. Downstream, `bun run cap` and the `/bench` route share one derivation so they cannot disagree. Their output is three picks: interactive, unattended worker, and EU-pinned.

#### E

## Why ccbench is an operational gate, not a quality benchmark

ccbench tells you whether a model can hold an agent loop. It does not tell you which model is smarter — and treating it as a ranking produces nonsense.

Each run copies a committed fixture into a throwaway sandbox, spawns `claude -p` against the IU Anthropic route with the model pinned across all four `ANTHROPIC_DEFAULT_*` tiers, parses the stream-json transcript, and grades the resulting files mechanically. What gets measured: whether the model drives the loop at all, how fast, at what dollar cost, how prompt caching behaves, where it times out.

The current field is 13 models. 11 of 13 score a flat 1.000. That is the correct answer to "can it hold a loop" and no answer at all to "which is smarter." Used as a ranking, that score hands the pick to whatever tiebreak survives — cost, latency — because the score itself separates nobody. Used as a gate, it does exactly the job it was built for: keep out models that cannot complete a tool loop.

Quality signal comes from external leaderboards — OpenRouter, ArtificialAnalysis, Epoch AI, LMArena — pulled into `metric_snapshot`. Never from ccbench. The split is deliberate: leaderboard scores say nothing about whether a model survives a real agent loop, how it caches, or where it times out. Only running the loop shows that.

A concrete case: the leaderboard index alone picked claude-fable-5-1 for the orchestrator slot. A 130-session ccbench run found the field saturated at 1.00 and claude-fable-5 the most expensive way to buy that identical score. The measurement replaced the leaderboard inputs for that category — not because fable-5 failed, but because paying more for a gate everyone passes is waste.

A few operational details worth knowing:

- **Real money.** Every run hits the API. `--yes` is required for non-interactive execution; `--dry-run` costs nothing. Don't discover the bill after a sweep across 13 models.
- **Sandbox isolation.** The sandbox needs its own `CLAUDE_CONFIG_DIR`. Without it, the run loads the global `CLAUDE.md`, MCP servers, and hooks — and the benchmark measures the dotfiles instead of the model.
- **Single derivation.** `bun run cap` and the `/bench` route share one derivation from the same data, so they cannot disagree. Output: three picks (interactive, unattended worker, EU-pinned).

---

## landing — Broad-register landing page hero plus three benefits

Task prompt given to every model (system prompt: the voice guide):

> Write the hero section and the three-benefit block of the landing page for the product below. Readers are smart but not necessarily developers. Aim at the reader's problem, not their knowledge level. Use only the facts given.
>
> ---
> Product: free-planning-poker (website for agile teams to estimate stories together).
>
> - Estimates are anonymous and revealed together, all at once, only when the host flips the cards.
> - Why it matters: nobody anchors on the senior dev's number. A 3 next to a 13 shows two people hold different pictures of the work, and the talk that follows is worth more than the final number.
> - No accounts, no sign-up, no email, no pricing page. Free.
> - Open a room, share the link, estimate. A room opens in one click; teammates join from the link in a browser, no install.
> - Works on phones, so remote and hybrid teams can join from anywhere.
> - Card decks: Fibonacci (0, 1, 2, 3, 5, 8, 13, 21), T-shirt sizes (XS to XL), and a custom deck.
> - Rooms disappear after 24 hours of inactivity; nothing is stored about the people in them.
> - Audience: product owners, scrum masters, developers, and managers who have never run a planning session and just need a number everyone agrees on.
> - Output wanted: hero headline, one-sentence subline, one call-to-action label, then exactly three benefits (short title plus one or two sentences each).

#### A

**Hero**

**Headline:** Estimate as a team. Reveal all at once.

**Subline:** Open a room, share the link, and everyone picks a card for the same story — hidden until the host flips them, so no one's number sets the rest.

**CTA:** `Open a room`

---

**Three benefits**

- **Hidden until the flip.** Every estimate is anonymous and shows up at the same moment, so the senior dev's number can't pull the room before anyone else has committed. When a 3 lands next to a 13, you've found two different pictures of the same work — and that talk is worth more than whichever number you end on.

- **Nothing to set up, nothing left behind.** No accounts, no sign-up, no email, no pricing page — a room opens in one click and teammates join from the link in any browser, phone included. Rooms disappear after 24 hours of inactivity, and nothing is stored about the people in them.

- **Pick a deck and run the session.** Fibonacci, T-shirt sizes, or a deck you define yourself. If you've never run a planning session, this is the whole process: open, share, estimate, flip.

#### B

# Hero

**Everyone votes at once. Nobody follows the loudest number.**

Open a room in one click, share the link, and your team estimates together from any browser or phone, free and without sign-up.

`[Open a room]`

---

# Benefits

**Hidden until the flip**
Estimates stay anonymous until the host reveals every card at once, so nobody adjusts their vote to match the senior dev's. When a 3 lands next to a 13, two people are picturing different work. That conversation matters more than the final number.

**One link, no setup**
Teammates join from the link on a laptop or a phone, wherever they're working. No account, no email, no install, no bill.

**Gone when you're done**
Rooms disappear after 24 hours of inactivity, and nothing is stored about the people in them.

#### C

# Find the conversation behind the number

Estimate stories together with free planning poker—no accounts, sign-up, or email.

**Create room**

### Let everyone estimate independently
Estimates are anonymous and stay hidden until the host reveals every card at once, so nobody anchors on the senior developer’s number. A 3 beside a 13 reveals different views of the work—and gives the team something worth discussing.

### Get everyone into the room
Open a room in one click; teammates join through the link in their browser, with nothing to install. Phones work too, so remote and hybrid teams can join from anywhere.

### Leave no personal data behind
Nothing is stored about the people in a room. Rooms disappear after 24 hours of inactivity.

#### D

**Hero**

# Get an estimate the whole team actually agrees on.

Built for agile teams and managers who have never run a planning session alike—open a room in one click, share the link, and start estimating stories together.

`[Open a room]`

---

**Benefits**

### Nobody anchors on the first number
Estimates stay anonymous and hidden until the host flips everyone's cards at once, so the room never defaults to the senior developer's number. A 3 next to a 13 shows two people hold different pictures of the work—and the talk that follows is worth more than the final number.

### Free, ephemeral, and zero setup
There are no accounts, no sign-ups, no email gates, and no pricing page. Remote and hybrid teammates join straight from the link in any browser or phone with nothing to install, and the room disappears after 24 hours of inactivity without storing anything about the people in it.

### Cards that fit how you size work
Estimate with the Fibonacci deck (0, 1, 2, 3, 5, 8, 13, 21), switch to T-shirt sizes (XS to XL), or use a custom deck. Whether you are a scrum master, product owner, developer, or a manager who just needs a number everyone agrees on, the room works the way your team talks.

#### E

## Hero

# Planning poker that keeps estimates honest

Everyone votes hidden, the host reveals all at once — and the gap between a 3 and a 13 starts a conversation worth more than the final number.

`[Create a room]`

---

## Benefits

**Hidden until reveal**
Estimates stay covered until the host flips every card at once. Nobody anchors on the senior dev's number; the quiet disagreement shows up instead of getting swallowed.

**One click, no accounts**
Open a room, share the link, estimate. No sign-up, no email, no install. Teammates join from the link in any browser — phone or laptop — so remote and hybrid teams are in the same room in seconds.

**Nothing stored, nothing to manage**
Rooms disappear after 24 hours of inactivity, and nothing is kept about the people in them. Pick a deck — Fibonacci, T-shirt sizes, or your own — and go.

---

## ui-copy — UI microcopy for one screen, as a labeled list

Task prompt given to every model (system prompt: the voice guide):

> Write the UI microcopy for the screen described below. Output exactly the labeled list requested, one line per string, nothing else.
>
> ---
> Screen: "Join a room" in free-planning-poker. The user pastes or types a 6-character room code (letters and digits, case-insensitive) or arrives via a shared link, enters a display name, and joins.
>
> - Empty state: the lobby of a freshly opened room, before anyone else has joined. The host is alone. The share link is the main action; copying it puts it on the clipboard.
> - Join can fail for exactly three reasons, and the error should name the actual one when known: the room code does not exist (typo), the room expired (rooms close after 24 hours of inactivity), or the room is full (the limit is 12 people).
> - For this task: write one error message for the failed join where the cause is unknown (network or server), with a clear next step. Assume a retry usually works.
> - Primary actions on the screen: join the room, create a new room instead, and go back to the start page. Three button labels, one per action.
> - Tooltip: on the display-name field, explaining that the name is shown to the other people in the room and is not stored after the room closes.
> - Tone: plain, friendly, no exclamation marks, no apology theatre. Strings are short; they must fit on a phone.
> - Output format: a labeled list, one line per string, exactly these labels: EMPTY_STATE_TITLE, EMPTY_STATE_BODY, JOIN_ERROR, BUTTON_JOIN, BUTTON_CREATE, BUTTON_BACK, TOOLTIP_NAME.

#### A

EMPTY_STATE_TITLE: Your room is ready
EMPTY_STATE_BODY: Copy the room link and share it with your team.
JOIN_ERROR: Couldn't join the room. Try again.
BUTTON_JOIN: Join room
BUTTON_CREATE: Create room
BUTTON_BACK: Return to start
TOOLTIP_NAME: Others in the room can see your name. It’s deleted when the room closes.

#### B

EMPTY_STATE_TITLE: Just you so far
EMPTY_STATE_BODY: Copy the link and send it to your team. They join without an account.
JOIN_ERROR: Couldn't join the room just now. Try again in a moment.
BUTTON_JOIN: Join room
BUTTON_CREATE: Create room
BUTTON_BACK: Back to start
TOOLTIP_NAME: Everyone in the room sees this name. It's deleted when the room closes.

#### C

EMPTY_STATE_TITLE: No one else is here yet
EMPTY_STATE_BODY: Copy the room link and send it to your team to start estimating.
JOIN_ERROR: Couldn't join the room — check your connection and try again.
BUTTON_JOIN: Join room
BUTTON_CREATE: Create new room
BUTTON_BACK: Back to start
TOOLTIP_NAME: Shown to others in the room and not stored after the room closes.

#### D

EMPTY_STATE_TITLE: Just you so far
EMPTY_STATE_BODY: Copy the link and send it around — anyone with it joins, no account needed.
JOIN_ERROR: Couldn't reach the room — the connection dropped on the way. Try again, that usually works.
BUTTON_JOIN: Join room
BUTTON_CREATE: Create new room
BUTTON_BACK: Back to start
TOOLTIP_NAME: Everyone in the room sees this name. It's gone once the room closes.

#### E

EMPTY_STATE_TITLE: You're the first one here
EMPTY_STATE_BODY: Share the link so your team can join — no account needed. `[Copy link]`
JOIN_ERROR: Couldn't reach the room — check your connection and try again.
BUTTON_JOIN: Join room
BUTTON_CREATE: Create new room
BUTTON_BACK: Back
TOOLTIP_NAME: Visible to everyone in the room. Deleted when the room closes.

---

## rewrite — Rewrite a convoluted AI-style paragraph into clear structured prose

Task prompt given to every model (system prompt: the voice guide):

> Rewrite the text below for senior engineers. Keep every fact and number, drop everything else. Use structure where the content is enumerable (bullets, a table) and prose where it is reasoning. Say each point once.
>
> ---
> Original paragraph (the text to rewrite; it is the only source of facts):
>
> When it comes to the question of how much thinking a reasoning model should be allowed to do, it is important to understand that thinking is not merely an overhead cost to be minimized, it is in fact the very lever through which quality is ultimately obtained, and this is something that the measurements consistently reveal, since a model such as Luna, which scores 16.8 when thinking is switched off entirely, climbs all the way to 37.5 once the effort is set to its maximum, which is to say that the thinking is not a tax on the answer, it is the answer itself in the making.
>
> That said, the lever only works if the budget allows it to, because a model that has been given too small a token budget will happily spend all of it on hidden reasoning and then return an HTTP 200 with empty content and a finish reason of length, and this silent failure, which looks like success to any caller that does not inspect the finish reason, is not a sign that the model is bad, it is a sign that the budget was too small, so the budget must be raised before the effort is ever lowered, and it should be remembered that budget that goes unused is not billed, so being generous costs nothing, and generosity with the budget is therefore the safe and sensible default in every case.
>
> Finally, and this is the part that is most easily forgotten, the effort should always be set explicitly rather than left to the default, because glm-5.3-flash, for example, defaults to max, which is not the best setting for it but its worst, so the default is not a neutral choice, it is a choice somebody else made for you, and it is a choice that can be wrong.

#### A

# Reasoning effort and token budgets

Thinking is where reasoning-model quality comes from, so budget for it generously and always set effort explicitly.

## Effort drives quality

| Luna | Score |
|-|-|
| Thinking off | 16.8 |
| Max effort | 37.5 |

## Raise the budget before lowering effort

An undersized token budget fails silently. The model spends all of it on hidden reasoning and returns:

- **Status:** HTTP 200
- **Content:** empty
- **`finish_reason`:** `length`

Any caller that doesn't inspect `finish_reason` reads this as success. The model isn't the problem; the budget is. Raise the budget before you touch effort. Unused budget isn't billed, so a generous budget costs nothing and is the safe default everywhere.

## Set effort explicitly

A default is a choice someone else made, and it can be wrong. glm-5.3-flash defaults to max, which is its worst setting.

#### B

**Thinking is where the quality comes from.** Luna scores 16.8 with thinking off and 37.5 at max effort.

The lever only moves if the token budget allows it. A model with too small a budget spends all of it on hidden reasoning and returns:

- HTTP 200
- empty content
- `finish_reason: length`

Any caller that doesn't inspect `finish_reason` reads that as success. Diagnose it as a budget problem: raise the budget before lowering the effort. Unused budget isn't billed, so a generous budget is the safe default.

**Set effort explicitly.** The default is a choice someone else made, and it can be wrong — glm-5.3-flash defaults to max, which is its worst setting.

#### C

Thinking drives answer quality. Luna’s measured scores:

| Thinking effort | Score |
|---|---:|
| Off | 16.8 |
| Maximum | 37.5 |

An undersized token budget can be consumed entirely by hidden reasoning. The model then returns HTTP `200` with empty content and finish reason `length`. Callers that ignore the finish reason see apparent success. This failure indicates insufficient budget rather than poor model quality.

- **Raise the budget before lowering effort.** Unused budget is not billed, so a generous token budget is the safe default in every case.
- **Set effort explicitly.** Leaving it unset accepts someone else’s choice, which can be wrong: `glm-5.3-flash` defaults to `max`, its worst setting.

#### D

Reasoning effort is the primary quality lever on thinking models. Luna scores 16.8 with thinking off and 37.5 at `max` effort.

- **Over-allocate the token budget.** Unused budget isn't billed, so a generous ceiling is free. A too-small budget gets burned entirely on hidden reasoning and returns HTTP 200 with empty content and `finish_reason: length` — a silent failure for any caller that doesn't inspect `finish_reason`. Always raise the budget before lowering effort.
- **Set effort explicitly.** Leaving it out delegates the choice to a provider default that can be actively wrong: `glm-5.3-flash` defaults to `max`, which is its worst setting.

#### E

## Thinking effort is the quality lever, not overhead

Luna scores 16.8 with thinking off and 37.5 at max effort. The reasoning *is* the work — don't minimize it.

Three rules for configuring it:

- **Budget before effort.** A model given too few tokens will spend them all on hidden reasoning and return HTTP 200 with empty content and `finish_reason: length`. This looks like success to any caller that doesn't inspect the finish reason. Fix: raise the budget. Unused budget isn't billed, so oversizing costs nothing.
- **Set effort explicitly.** glm-5.3-flash defaults to max — its *worst* setting. The default is someone else's choice, and it can be wrong.
- **Lower effort only after the budget is right.** A bad result on a tight budget is a budget problem, not an effort problem.

---

## de-briefing — German personal briefing (bullets) from raw daily data

Task prompt given to every model (system prompt: the voice guide):

> Schreibe aus den Rohdaten ein persönliches Tagesbriefing auf Deutsch, als Bullet-Liste. Das ist eine Notiz an mich selbst: telegrafisch ist erlaubt, englische Tech-Begriffe bleiben englisch. Nutze nur die Rohdaten.
>
> ---
> Rohdaten von heute (Samstag), vom Agenten gesammelt:
>
> Training
> - Kreuzheben: 3x5 @ 150 kg, alle Sätze sauber, RPE 8. Letzte Woche 3x5 @ 145 kg. Geschätztes 1RM: 185 kg (vor vier Wochen: 180 kg).
> - Kniebeuge ausgelassen. Knie meldet sich nach tiefen Beugen, seit zwei Wochen keine Tiefenarbeit mehr, Schmerz 0/10 beim Gehen.
> - Schlaf letzte Nacht: 6 h 40, Ruhepuls 54 (Schnitt der letzten 30 Tage: 52).
> - Geplant für morgen: Ruhetag, 40 min locker Zone 2 laufen.
>
> Server
> - Mini: Platte bei 87 % belegt (vor einer Woche 81 %). Größter Block: Docker-Images und Build-Cache, 212 GB von 460 GB gesamt. Ab 90 % schlagen die Backups fehl.
> - VPS: Platte 41 %, RAM 63 %, alles grün.
>
> Cron
> - `morning-briefing` (07:00) ist heute fehlgeschlagen: Timeout nach 600 s beim Abruf der Kalenderdaten. Gestern lief derselbe Job durch. Erster Fehler in 23 Tagen.
> - Alle anderen 11 Jobs grün. Letzter Backup-Lauf: 03:10, 14 GB, ok.
>
> Lesen
> - "Designing Data-Intensive Applications": Seite 312 von 612, Kapitel 7 (Transactions) fertig. Letzte Woche Seite 198, also 114 Seiten in 7 Tagen, doppelt so schnell wie der Schnitt.
> - Nächstes Kapitel: 8 (The Trouble with Distributed Systems), ca. 40 Seiten.
>
> Gewünscht: Briefing als Bullet-Liste für den Tag, wichtigstes zuerst, mit ehrlichen Status-Flags (was dringend ist, was beobachtet werden soll).

#### A

- **Mini-Platte (dringend, heute):** 87 % belegt, ab 90 % failen die Backups. Vor einer Woche waren es 81 %. Bei diesem Tempo ist die Grenze in ~3–4 Tagen erreicht (Hochrechnung). Docker-Images + Build-Cache belegen 212 von 460 GB → heute aufräumen. Letztes Backup 03:10, 14 GB, noch ok.
- **Cron (beobachten):** `morning-briefing` 07:00 failed mit Timeout nach 600 s beim Abruf der Kalenderdaten. Gestern lief er grün, das ist der erste Fehler in 23 Tagen. Morgen früh noch einmal prüfen und erst bei Wiederholung debuggen. Die restlichen 11 Jobs sind grün.
- **Kreuzheben:** 3x5 @ 150 kg, alle Sätze sauber, RPE 8. Das sind +5 kg zur Vorwoche. e1RM 180 → 185 kg in 4 Wochen → der Block wirkt.
- **Knie (beobachten):** Kniebeuge heute ausgelassen. Seit 2 Wochen keine Tiefenarbeit, beim Gehen 0/10 → ruhig. Tiefe Beugen weiter weglassen.
- **Erholung (beobachten):** Schlaf 6 h 40. Ruhepuls 54, Schnitt der letzten 30 Tage 52 → leicht erhöht.
- **Morgen:** Ruhetag, 40 min locker Zone 2 laufen.
- **Lesen:** DDIA S. 312/612, Kapitel 7 (Transactions) fertig. 114 Seiten in 7 Tagen = doppeltes Tempo. Als Nächstes Kapitel 8 (The Trouble with Distributed Systems), ~40 Seiten.
- **VPS:** Platte 41 %, RAM 63 %, alles grün.

#### B

- **Server — dringend:** Mini-Disk bei 87 % (Vorwoche: 81 %), ab 90 % schlagen die Backups fehl. Docker-Images und Build-Cache belegen 212 von 460 GB → heute aufräumen. VPS grün (Disk 41 %, RAM 63 %).
- **Cron — beobachten:** `morning-briefing` (07:00) nach 600 s im Timeout beim Kalender-Abruf. Erster Fehler in 23 Tagen, gestern lief der Job durch → noch einmal beobachten, bevor ich grabe. Alle anderen 11 Jobs inkl. 03:10-Backup (14 GB) grün.
- **Training:** Kreuzheben 3x5 @ 150 kg sauber @ RPE 8 (Vorwoche: 145 kg), e1RM 180 → 185 kg in 4 Wochen. Kniebeuge ausgelassen; nach 2 Wochen ohne Tiefenarbeit ist das Knie beim Gehen bei 0/10 Schmerz. Schlaf 6 h 40, Ruhepuls 54 (30d-Schnitt: 52). Morgen: Ruhetag, 40 min locker Zone 2.
- **Lesen:** *Designing Data-Intensive Applications* bei S. 312/612 (Kap. 7 *Transactions* fertig). 114 Seiten in 7 Tagen = doppeltes Tempo zum Schnitt. Als Nächstes: Kap. 8 (*The Trouble with Distributed Systems*, ca. 40 S.).

#### C

- **Mini — dringend:** Platte 87 % voll, vor einer Woche 81 %. Ab 90 % schlagen Backups fehl — noch 3 Prozentpunkte Luft. Docker-Images und Build-Cache belegen 212 GB von 460 GB gesamt. Heute aufräumen.
- **Cron — beobachten:** `morning-briefing` um 07:00 fehlgeschlagen: Timeout nach 600 s beim Kalenderabruf. Erster Fehler in 23 Tagen, gestern lief der Job durch. Nächsten Lauf prüfen.
- **Knie — beobachten:** Kniebeuge ausgelassen. Knie meldet sich nach tiefen Beugen; seit zwei Wochen keine Tiefenarbeit. Beim Gehen Schmerz 0/10 — über Belastungsschmerz sagt das nichts.
- **Erholung — im Blick behalten:** 6 h 40 Schlaf, Ruhepuls 54 gegenüber 52 im 30-Tage-Schnitt. Morgen geplant: Ruhetag mit 40 min lockerem Zone-2-Lauf.
- **Kreuzheben — Fortschritt:** 3×5 @ 150 kg, alle Sätze sauber, RPE 8. Letzte Woche 145 kg. Geschätztes 1RM über vier Wochen: 180 → 185 kg.
- **Restlicher Betrieb — grün:** VPS bei 41 % Platte und 63 % RAM. Alle anderen 11 Cron-Jobs grün. Letztes Backup um 03:10: 14 GB, erfolgreich.
- **Lesen — Tempo hoch:** „Designing Data-Intensive Applications“ bei Seite 312/612, Kapitel 7 (*Transactions*) fertig. 114 Seiten in sieben Tagen, doppelt so schnell wie der Schnitt. Als Nächstes: Kapitel 8, *The Trouble with Distributed Systems*, ca. 40 Seiten.

#### D

# Briefing — Samstag

- **Mini Disk 87 % — handeln.** Docker-Images + Build-Cache sind 212 GB; ab 90 % brechen Backups. Heute aufräumen: `docker system prune`, alte Images raus, Build-Cache kürzen. Nicht mehr "nächste Woche".
- **`morning-briefing` Timeout** — 600 s beim Kalender-Abruf, erster Fehler seit 23 Tagen. Gestern noch grün → vermutlich API-Seite, kein eigener Bug. Morgen beobachten; schlägt's nochmal fehl, Logs ziehen und Timeout-Handling prüfen.
- **Kreuzheben läuft.** 3×5 @ 150 kg, RPE 8, sauber. e1RM jetzt 185 kg (vor vier Wochen 180). Block funktioniert, Schema beibehalten.
- **Knie ruhig.** Schmerz 0/10 seit zwei Wochen ohne Tiefenarbeit. Kniebeuge bleibt draußen — frühestens August wieder einbauen.
- **Schlaf knapp.** 6:40, Ruhepuls 54 (Schnitt 52). Zwei Schläge über Baseline ist nicht dramatisch, aber morgen Ruhetag + Zone-2-Lauf passt.
- **DDIA überraschend schnell.** 114 Seiten in 7 Tagen, doppeltes Lesetempo → Kapitel 7 fertig. Kapitel 8 (Distributed Systems) ist ~40 Seiten, realistisch bis Mitte nächster Woche.
- **VPS grün.** Disk 41 %, RAM 63 %, nichts zu tun.
- **Cron sonst sauber.** 11/12 Jobs grün, Backup 03:10 durch (14 GB).

#### E

- **Mini-Platte, dringend:** 87 % voll, vor einer Woche 81 % — ab 90 % fallen die Backups aus. Größter Block: Docker-Images und Build-Cache, 212 GB von 460 GB. Heute `docker system prune` und Build-Cache leeren, nicht auf Montag schieben. Bei dem Tempo ist die 90 %-Grenze in ~3 Tagen erreicht.
- **Cron `morning-briefing`, beobachten:** heute Timeout nach 600 s beim Kalender-Abruf. Gestern lief der Job durch, erster Fehler in 23 Tagen. Noch nicht graben — einmal morgen früh abwarten, zweiter Fehler = Kalender-API prüfen. Restliche 11 Jobs grün, Backup 03:10 mit 14 GB ok.
- **VPS:** Platte 41 %, RAM 63 %, nichts zu tun.
- **Training, Block funktioniert:** Kreuzheben 3x5 @ 150 kg sauber bei RPE 8, letzte Woche 145. e1RM 180 → 185 in vier Wochen. Rep-Schema so lassen. Kniebeuge weiter raus — Knie seit zwei Wochen ohne Tiefenarbeit, 0/10 beim Gehen. Nicht vor Schmerzfreiheit auch unter Last wieder tief beugen.
- **Schlaf, leicht drunter:** 6 h 40, Ruhepuls 54 gegen 52 im 30-Tage-Schnitt. Noch kein Muster, nur ein Datenpunkt. Morgen Ruhetag plus 40 min Zone 2 passt dazu.
- **Lesen, läuft:** DDIA Seite 312/612, Kapitel 7 (Transactions) fertig. 114 Seiten in 7 Tagen, doppeltes Normaltempo — also wirklich drin. Als Nächstes Kapitel 8 (The Trouble with Distributed Systems), ~40 Seiten, passt in einen Abend.

