# Audio Stack — Local TTS + STT

**Decision (2026-04-29):** run TTS and STT locally on Apple Silicon. TTS uses **Fish S2
Pro** (8-bit MLX); STT uses **NVIDIA Parakeet TDT v3**. Both chosen over hosted
alternatives and over several rejected local engines.

Operational wiring (launchd services, ports, EQ chain strings, endpoints, helper
orchestration) lives in dotfiles `localai/`. This record is the *why*.

## Why local at all

Hosted EU audio models exist on the IU endpoint (`whisper`, `tts`, `tts-hd`, all
Azure Sweden Central — see [vision-and-image.md](./vision-and-image.md) for the residency
table). They were evaluated and **not** adopted as the primary path:

- **TTS is a downgrade if hosted.** The whole point of the local TTS is a cloned, expressive
  voice identity with inline emotion tags. Stock hosted `tts` voices have no cloning and no
  emotion tags — that throws away the identity. Local stays.
- **STT is closer to a wash.** Hosted `whisper` (EU) is a credible Parakeet replacement and
  would remove the local Metal-crash maintenance burden — but Parakeet already works and is
  faster locally. Hosted `whisper` is kept only as a documented **fallback/redundancy** (when
  the local stack is down, or for batch where the local Metal cap hurts).
- **Diarization is the one genuinely new hosted capability** the local stack can't do
  (`gpt-4o-transcribe-diarize`). Worth keeping in mind for multi-speaker use cases, accepting
  US routing for that specific case.

## STT — Parakeet over Whisper

| Model | Size | Languages | Speed |
|-|-|-|-|
| mlx-community/parakeet-tdt-0.6b-v3 | 1.2 GB | 25 EU langs incl. EN/DE | 10–60× real-time |

**Why not Whisper:** mlx-audio 0.4.2 has a bug — `load_model()` doesn't attach
`WhisperProcessor`, so `get_tokenizer()` raises `Processor not found`. Patching to load the
processor at request time triggers an MLX Metal threading crash (`There is no Stream(gpu, 2)
in current thread`). Parakeet works cleanly, and `whisper-large-v3-turbo` is superseded
anyway — Parakeet v3 is ~25% smaller, ~3× faster, similar accuracy.

## TTS — Fish S2 Pro

| Model | Size | Voices | Notes |
|-|-|-|-|
| appautomaton/fishaudio-s2-pro-8bit-mlx | 6.7 GB | clone-only, 2 production refs (de/en) | ~2–10× RTF on M2 Pro |

5B-parameter dual-AR architecture (4B slow AR + 400M fast AR), trained on 10M+ hours, with
**15,000+ free-form prosody/emotion tags** as a first-class feature (`[chuckle]`,
`[whisper]`, `[excited]`, `[pause]`, …). Open-weight as of March 2026 under the Fish Audio
Research License (non-commercial — personal use only). Fish's own April 2026 blind study
scored it 3.07 vs ElevenLabs V3 at 1.90 (directional, vendor-run, not impartial).

Promoted to production after a side-by-side **blind listening comparison** vs Voxtral, the
fish.audio library voices (Ben), Tim Peters, Paluten, and the unprocessed Pip recording.

### Rejected alternatives

| Tool | Why rejected |
|-|-|
| Voxtral 4B TTS (Mistral) | Prior baseline. Tier-1 native German but emotionally flat, no inline emotion tags. |
| Qwen3-TTS VoiceDesign | English-accented German ("Hasselhoff effect") — instruct path is Chinese/English-only by design. |
| Qwen3-TTS Base + clone | Better German but needs a server-accessible WAV reference; Voxtral preset was simpler at the time. |
| F5-TTS-German | Documented umlaut bug requiring Ä→ae preprocessing; fragile for production. |
| Piper TTS (thorsten-de) | Native German phonetics but robotic. |
| Kokoro-82M | Fastest of the lot but emotionally flat ("narrator reading, not performing"). |
| Orpheus-3B | Best emotion-tag support but MPS broken on Mac; only viable via CPU/Ollama. |
| VibeVoice (Microsoft) | Robotic intonation; male voices weaker due to training-data skew. |
| Ollama (Gemma local LLM) | (LLM, adjacent) Cloud Sonnet cheaper than local electricity for light use; better agent quality. |
| LocalAI (mudler) | llama.cpp, not MLX — 40–90% slower on this hardware. |
| WhisperKit | `serve` unreliable, fragile Swift build. |

## The dominant insight — reference clip quality

> **Reference clip quality dominates output quality.** Fish clones the timbre *and cadence*
> of the reference. Synthetic voices (macOS Daniel, prior TTS output) clone-of-clone
> catastrophically. Real human voice → real human output.

Two concrete consequences:

- **EQ on the reference itself, not just the output.** The production German reference (a Pip
  Klöckner snippet) was Audacity-cut and had a "smile EQ" baked into the *reference clip*
  before cloning. Raw Pip was "too dumpf"; the same EQ on the reference measurably shapes how
  the model speaks, beyond what output post-processing achieves.
- **The +5% reference-side `atempo` trick.** Fish encodes the reference's prosodic structure
  into its conditioning. Speeding up the *reference clip* 3–8% (`atempo=1.05`, pitch
  preserved) before synthesis produces a faster *baseline* delivery with appropriately scaled
  pauses and emphasis — not just a sped-up version of slow output. Above ~1.10 it feels
  rushed. This energized the flat "Ben" reference; the chosen Pip reference didn't need it (its
  natural cadence was already engaging). Post-processing the output instead only makes boring
  delivery faster.

## German Tier-2 limitation

Fish's training tiers: Tier 1 (full) = Japanese, English, Chinese; **Tier 2 (strong) =
German** (plus Korean, Spanish, Portuguese, Arabic, Russian, French); Tier 3 = 70+ more.

Tier 2 means **less training data, not "speaks with an English accent."** German output is
coherent native pronunciation but with flatter prosody and a more generic rhythm than a
Tier-1 model. **Voice cloning does not fix this** — the reference clip sets *who* the voice
sounds like, not the underlying phonological quality. Compensation strategy:

1. A high-quality real German reference clip (not synthetic).
2. Pre-process the reference: Audacity-cut + smile EQ baked in.
3. Post-process the output with the same EQ chain.

This stack measurably outperformed Voxtral 4B (Tier-1 native German but emotionally flat) in
side-by-side listening.

## Known model constraints (informing chunking, not wiring)

- **Metal allocator cap.** On M2 Pro 32 GB, Fish's attention scratch exceeds the ~20 GB
  per-buffer Metal cap around the 1300-character mark and the worker dies. Practical safe
  ceiling: **800 chars/chunk** (~50 s audio). Bigger unified-memory Macs can push higher.
- **Long-generation drift.** Past ~2048 audio codec tokens (~95 s) timbre wanders. The
  800-char ceiling is comfortably below this, so chunking is bounded by Metal, not drift.
- **No instruct prompt.** Tone is controlled entirely by the reference clip + inline tags —
  there is no system message for tone.
- **Truncation is silent.** Under-budgeting `max_new_tokens` returns truncated audio without
  raising; over-budgeting is free (the loop breaks on EOS).
