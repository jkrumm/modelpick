# Vision Reading + Image Generation

> **Current verdict (2026-09-12):** `gemini-3.5-flash` holds for diagram/screenshot reading —
> it is not obsolete, and the AA general intelligence index is not vision evidence.
> `gpt-image-2` holds for generation.
> **Status of this record:** partly superseded — see §2026-09-04 update: the committed pick
> moved, undocumented (the 2026-05-22 POC verdict at the top predates the committed
> `gemini-3.5-flash` pick).
> Settled patterns live in [../GUIDELINES.md](../GUIDELINES.md).

**Decisions (POC 2026-05-22):**

- **Diagram/screenshot reading** → `gemini-3-flash-preview` as default, `gemini-3-pro-preview`
  for dense/hard cases. Both beat Anthropic Haiku on dense diagram structure.
- **Image generation** → `gpt-image-2` (`gpt-image-1*` also fine; `dall-e-3` is dead).
- **Sensitive visual content** → `claude-sonnet-4-6-eu` (EU-resident), because the Gemini and
  GPT-image paths are not EU-guaranteed.

These are direct fetches against the IU unified endpoint, not new vendor integrations.

## The IU endpoint is multimodal

The IU unified endpoint is **not** chat-only. The OpenAI transport already serves vision
input, image generation, TTS, and STT; a separate Replicate transport covers the long tail
(flux, SDXL, audio/video). All verified live. This is what makes "pick an alias" the unit of
decision rather than "integrate a provider."

## Reading bake-off — model quality only separates on dense diagrams

Two diagrams, identical structural prompt, `temperature: 0`.

**Simple diagram (~6 nodes):** every model was 100% correct. Haiku was fastest (3.8s) and
cheapest; gpt-4.1-mini also perfect; Gemini Pro/Flash perfect but ~3× slower.

**Dense diagram (4 nested frames, ~14 multi-line nodes, bidirectional edges):**

| Model | Latency | Accuracy on the dense diagram |
|-|-|-|
| gemini-3-pro-preview | 27.4s | **Best.** All 4 frame names correct, every node in the right frame, flagged the bidirectional edges. |
| gemini-3-flash-preview | 13.6s | **Best balance.** All 4 frames + correct placement; missed only the bidirectional nuance. |
| claude-haiku-4-5 | 10.0s | Fast but flattened the frame hierarchy, mis-placed nodes, misread a label. |
| gpt-4.1-mini | 17.3s | Worst on nesting — double-listed nodes, tangled in overlapping frames. |

**Verdict:** Gemini (Flash/Pro) beats Haiku on dense diagram structure. On simple ones it's a
tie and Haiku wins on cost/latency.

### The structured-data nuance that changes the calculus

For **Excalidraw** reading, the paired `.excalidraw` JSON carries *exact* structure
(`frameId`, `containerId`, arrow bindings, `groupIds`) — which is precisely Haiku's weakness
(frame flattening). So:

- **Excalidraw (JSON available):** JSON is the structural ground truth; vision is supplementary
  → Haiku is adequate, Gemini-Flash a cheap upgrade for the visual gestalt.
- **Arbitrary screenshots (no JSON):** vision quality is the *only* signal →
  **Gemini-3-Flash is the default**, Gemini-3-Pro for hard cases.

A separate finding: **rasterization fidelity, not the model, was the real bottleneck.** SVG→PNG
via `qlmanage` crops wide diagrams; `svglib` renders text as tofu boxes; `cairosvg` needs an
unlinked native lib. Headless Chrome (`--screenshot` of an HTML-wrapped SVG at native
dimensions) is faithful — fonts, aspect, every label legible. The rasterizer is the
engineering; the model is a swappable parameter.

## Image generation

`gpt-image-2` works and produced a clean, legible architecture diagram — usable for asset
generation. `gpt-image-1{,-mini,.5}` also fine. `dall-e-3` is deprecated (`410 ModelDeprecated`)
— this is why image gen "wasn't working" before; it was pinned to the dead model.

## Data residency — the deciding factor for sensitive content

The middleware exposes the serving backend in response headers, so residency is verifiable:

| Model / capability | Backend | EU? |
|-|-|-|
| `tts`, `tts-hd` (TTS) | Azure Sweden Central | Yes |
| `whisper` (STT) | Azure Sweden Central | Yes |
| `claude-*-eu` aliases | GDPR-only Claude gateway | Yes |
| `gpt-image-*` (image gen) | OpenAI vendor key | No (US) |
| `gpt-4o-transcribe` (STT) | OpenAI vendor key | No (US) |
| `gemini-3-*-preview` (vision) | Google vendor — region not exposed | Unverified → treat as non-EU |

**Rule:** anything carrying personal/voice content stays on the Azure-Sweden models or the
`claude-*-eu` aliases. OpenAI-vendor and Gemini paths are acceptable for **non-sensitive
content already in git** (a committed diagram), not for arbitrary recorded speech or sensitive
screenshots. For a sensitive screenshot, use `claude-sonnet-4-6-eu`. See
[audio-stack.md](./audio-stack.md) for how the same residency line gates the audio choices.

## The architectural placement insight — stateless call vs agent loop

There are two fundamentally different shapes of work, and they belong in different homes:

| Shape | Examples | Right home | Cost |
|-|-|-|-|
| **Stateless single HTTP call** | read one image, generate one image, TTS a string, transcribe a file | a direct `fetch` tool (e.g. a sideclaw HTTP tool) | ~0 (IU per-token, no Max, no worker) |
| **Multi-step agent session** | drive a browser: navigate + click + inspect + screenshot | an agent loop | depends on driver model |

The mistake to avoid is spinning up a whole agent session (cold spawn + tool loop) to do what
is really *one* vision/audio call. Diagram/image reading is a stateless call — it should be a
direct fetch, never a spawned worker session. Conversely, browser driving genuinely needs the
agent loop. The right move for a mixed skill is to **split it**: the stateless vision/audio
call becomes a cheap direct fetch (stronger model, off Max), and only the genuine
orchestration keeps an agent loop. The worker model for text tasks (sideclaw's `claude-sonnet-5`
/ `claude-haiku-4-5`, see [claude-code-model.md](./claude-code-model.md)) is irrelevant to
these — they are direct fetches that spawn no session at all.

## 2026-09-04 update: the committed pick moved, undocumented

The verdict above (`gemini-3-flash-preview` default / `gemini-3-pro-preview` for hard cases) was
never folded back into `stack_choice`. The actual committed vision pick, decided 2026-06-17, is
**`gemini-3.5-flash`** — a different id this doc predates, and the doc itself predates
`gemini-3.8-flash` entirely. From `src/db/seed.ts`:

> Best flash-tier vision model for document/chart/diagram reading: tops Roboflow Vision Evals
> across 67 prompts; AA quality 50 vs GPT-5.4-mini's 17 (the cheaper option is a false economy
> for structured extraction). $1.50/$9.00 per 1M, 155 tok/s.

That rationale is about document/chart reading generally, not a re-run of this doc's
diagram/screenshot bake-off — the deeper comparison against `gemini-3-pro-preview` and
`gemini-3.8-flash` on the dense-diagram cases above was never written up. Treat this doc's
POC verdict as superseded by the `gemini-3.5-flash` pick, not confirmed by it.

## 2026-09-12: `gemini-3.5-flash` is not obsolete for vision, and the general index cannot say whether it is

The vision slot looked stale: on AA's general intelligence index `gemini-3.5-flash` reads 33.0
against `gemini-3.8-flash`'s 41.2, at **twice the price** ($1.50/$9.00 vs $0.75/$3.75). That
comparison is not evidence about vision, and using it as such is the same error this stack made
with `arena_german` and prose — a scored dimension standing in for one it does not measure.

What the published vision evidence actually says:

| model | MMMU-Pro | CharXiv | Roboflow Vision Evals | note |
|-|-|-|-|-|
| `gemini-3.5-flash` | **83.6%** | 84.2% | **#1 of a 67-prompt leaderboard** | the incumbent |
| `gemini-3.8-flash` | not published | **86.2%** | not published | card compares against 3.7, never 3.5 |
| `glm-5.3-flash` | not published | 89.4% *with tools* | 66.3% overall | OCR **90.6**, extraction **83.5** |
| `gpt-5.6-luna` | 78.4% | not published | **71.5% overall** | detection 59.9, counting 66.2 |

Google's 3.8 model card benchmarks 3.8 against **3.7**, not 3.5, and publishes no MMMU-Pro,
DocVQA, OCRBench, ScreenSpot or Roboflow figure for it. There is therefore **no controlled
3.8-vs-3.5 vision comparison in existence**. The only same-protocol multi-model vision table
found is Roboflow's, and it covers Luna and GLM — neither of them the incumbent.

Two things worth carrying forward:

- **The task decides, not the overall score.** Roboflow's same-sample run has GLM-5.3-Flash
  *ahead* of Luna on OCR (90.6 vs 88.4) and data extraction (83.5 vs 81.4) while losing overall
  (66.3 vs 71.5) on localization, counting and reasoning. `read_image` is mostly "tell me what
  this diagram says", which is the OCR/extraction half.
- **Protocol confounds dominate.** Roboflow measured a ~15 mAP swing on GPT detection purely
  from box format (absolute XYXY vs normalized 0–1000 YXYX), and GPT-5.6 destabilising above
  ~2000×2000 images at low effort. Any vision comparison that does not fix prompt, schema,
  resolution and effort is measuring the harness.

**Verdict: `gemini-3.5-flash` holds.** It has the strongest published vision evidence of the
four and the only independent leaderboard win. The live argument against it is **price**, not
capability — and `glm-5.3-flash` is $0.15/$0.50 with the best OCR row measured, which makes it
the candidate to test if the vision bill ever matters. `vision` stays a **manual** category for
exactly this reason: nothing the recommender scores can rank it.

Re-open when Google publishes a 3.8-vs-3.5 vision comparison, or by running our own dense-diagram
bake-off — the method that decided this record in the first place.
