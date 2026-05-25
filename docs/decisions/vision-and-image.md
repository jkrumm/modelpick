# Vision Reading + Image Generation

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
orchestration keeps an agent loop. The worker model for text tasks (Kimi-K2.6, see
[kimi-bridge.md](./kimi-bridge.md)) is irrelevant to these — they are direct fetches that
spawn no session at all.
