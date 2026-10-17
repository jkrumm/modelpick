import { readFileSync } from "node:fs";
import { describe, expect, it, test } from "vitest";
import { prettifyName } from "./discover.js";
import { displayNameScore, parsePortalHtml } from "./portal.js";

const fixture = readFileSync(new URL("./__fixtures__/portal-export.html", import.meta.url), "utf-8");
const byId = new Map(parsePortalHtml(fixture).map((m) => [m.id, m]));
const pick = (id: string) => {
  const m = byId.get(id);
  if (!m) throw new Error(`${id} missing from fixture parse`);
  return m;
};

describe("displayNameScore — rejects the neighbour labels seen in the snapshot", () => {
  const mismatches: [string, string][] = [
    ["claude-opus-5-5", "Claude 4 Sonnet"],
    ["claude-opus-5-5", "Claude Opus 5"],
    ["gpt-5.4-2026-03-05", "GPT-5.4 mini"],
    ["o1-2024-12-17", "o1 Pro EU"],
    ["gpt-5.5-pro", "GPT 5.6 Luna"],
    ["gpt-5.5-pro", "GPT-5.5"],
    ["Kimi-K2.6", "Kimi K2.7 Code"],
    ["voxtral-mini-2602", "Text to Speech HD"],
    ["gemini-2.5-flash", "Google Gemini 2.0 Flash"],
    ["gemini-3-pro-image", "Google Gemini 3 Pro"],
    ["gpt-5-chat-latest", "GPT-5 Mini"],
    ["mistral-medium-3", "Mistral Medium 3.5"],
    ["Qwen3.7-Max", "Qwen 3.8-Max"],
  ];
  it.each(mismatches)("%s is not %j", (id, name) => {
    expect(displayNameScore(id, name)).toBeNull();
  });
});

describe("displayNameScore — accepts the right label", () => {
  const matches: [string, string][] = [
    ["claude-opus-4-5-20251101", "Claude Opus 4.5"],
    ["claude-haiku-4-5-20251001", "Claude 4-5 Haiku"],
    ["gpt-5.4-2026-03-05", "GPT 5.4"],
    ["gpt-5.4-mini-2026-03-17", "GPT-5.4 mini"],
    ["gpt-4o-2024-11-20", "GPT-4o"],
    ["o3-mini-2025-01-31", "o3-Mini"],
    ["mistral-large-2512", "Mistral Large"],
    ["Qwen/Qwen3.5-397B-A17B", "Qwen 3.5"],
    ["MiniMaxAI/MiniMax-M3", "MiniMax M3"],
  ];
  it.each(matches)("%s is %j", (id, name) => {
    expect(displayNameScore(id, name)).not.toBeNull();
  });

  it("prefers the plain name over a regional variant", () => {
    const plain = displayNameScore("claude-opus-4-5-20251101", "Claude Opus 4.5");
    const gdpr = displayNameScore("claude-opus-4-5-20251101", "Claude Opus 4.5 (GDPR)");
    expect(plain).toBeGreaterThan(gdpr ?? Number.POSITIVE_INFINITY);
  });
});

describe("parsePortalHtml on a real export slice", () => {
  it("names models after their own row, not a neighbour's", () => {
    expect(pick("gpt-5.4-2026-03-05").display_name).toBe("GPT 5.4");
    expect(pick("gpt-5.4-mini-2026-03-17").display_name).toBe("GPT-5.4 mini");
    expect(pick("claude-opus-4-5-20251101").display_name).toBe("Claude Opus 4.5");
    expect(pick("Kimi-K2.6").display_name).toBe("Kimi K2.6");
    expect(pick("gpt-5.5-pro").display_name).toBe("GPT 5.5 Pro");
    expect(pick("voxtral-mini-2602").display_name).toBe("Voxtral Mini (2602)");
    expect(pick("gpt-5.5-2026-04-23").display_name).toBe("GPT-5.5");
  });

  it("never labels an id with a name whose version or qualifier contradicts it", () => {
    for (const m of byId.values()) {
      expect(displayNameScore(m.id, m.display_name), `${m.id} -> ${m.display_name}`).not.toBeNull();
    }
  });

  it("takes the context window from the chosen row only", () => {
    expect(pick("gpt-5.4-2026-03-05").context_window).toBe(1000000);
    expect(pick("gpt-5.4-mini-2026-03-17").context_window).toBe(400000);
    expect(pick("Kimi-K2.6").context_window).toBe(256000);
    expect(pick("GLM-5.1").context_window).toBe(200000);
    expect(pick("gpt-5.5-pro").context_window).toBeNull();
    expect(pick("voxtral-mini-2602").context_window).toBeNull();
    expect(pick("gemini-3.6-flash").context_window).toBeNull();
  });
});

describe("prettifyName", () => {
  test("joins version digit pairs and parenthesises release stamps", () => {
    expect(prettifyName("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(prettifyName("claude-sonnet-4-5-20250929")).toBe("Claude Sonnet 4.5 (20250929)");
    expect(prettifyName("gpt-5.5-pro-2026-04-23")).toBe("GPT 5.5 Pro (2026-04-23)");
    expect(prettifyName("ministral-14b-2512")).toBe("Ministral 14b (2512)");
    expect(prettifyName("mistral-medium-3")).toBe("Mistral Medium 3");
    expect(prettifyName("Qwen/Qwen3.7-Max")).toBe("Qwen3.7 Max");
  });
});
