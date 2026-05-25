import { describe, it, expect } from "vitest";
import { curate, isDatedPin, propagateMetrics } from "../server/curate";
import type { ModelMetrics } from "../server/scoring/normalize";

describe("isDatedPin", () => {
  it("flags dated snapshot ids", () => {
    expect(isDatedPin("gpt-4o-2024-08-06")).toBe(true);
    expect(isDatedPin("claude-sonnet-4-5-20250929")).toBe(true);
    expect(isDatedPin("gpt-5.4-2026-03-05")).toBe(true);
  });

  it("does not flag undated ids", () => {
    expect(isDatedPin("gpt-4o")).toBe(false);
    expect(isDatedPin("claude-sonnet-4-5-eu")).toBe(false);
    expect(isDatedPin("gemini-3.5-flash")).toBe(false);
  });
});

describe("propagateMetrics", () => {
  it("fills metrics onto canonical siblings that lack them", () => {
    const models = [
      { id: "claude-sonnet-4-5-20250929", modality: "llm" },
      { id: "claude-sonnet-4-5-eu", modality: "llm" },
    ];
    const metrics: ModelMetrics[] = [
      { model_id: "claude-sonnet-4-5-20250929", quality: 0.8, coding: 0.8, cost: 0.5, speed: 0.6 },
    ];
    const out = propagateMetrics(models, metrics);
    const eu = out.find((m) => m.model_id === "claude-sonnet-4-5-eu");
    expect(eu).toBeDefined();
    expect(eu?.quality).toBe(0.8);
    expect(eu?.cost).toBe(0.5);
    expect(eu?.speed).toBe(0.6);
  });

  it("does not overwrite a model's own metrics", () => {
    const models = [
      { id: "gpt-5", modality: "llm" },
      { id: "gpt-5-2025-08-07", modality: "llm" },
    ];
    const metrics: ModelMetrics[] = [
      { model_id: "gpt-5", quality: 0.9, coding: 0.9, cost: null, speed: null },
      { model_id: "gpt-5-2025-08-07", quality: 0.1, coding: 0.1, cost: 0.4, speed: null },
    ];
    const out = propagateMetrics(models, metrics);
    const pin = out.find((m) => m.model_id === "gpt-5-2025-08-07");
    expect(pin?.quality).toBe(0.1); // kept its own
    const base = out.find((m) => m.model_id === "gpt-5");
    expect(base?.cost).toBe(0.4); // inherited the sibling's
  });

  it("leaves metric-less canonical groups untouched", () => {
    const models = [{ id: "mystery-model", modality: "llm" }];
    const out = propagateMetrics(models, []);
    expect(out).toEqual([]);
  });
});

const accessibleAll = () => true;

describe("curate", () => {
  it("marks AA-tracked LLMs current and drops untracked ones", () => {
    const models = [
      { id: "gemini-3.5-flash", modality: "llm" },
      { id: "gpt-3.5-turbo", modality: "llm" },
    ];
    const metrics: ModelMetrics[] = [
      { model_id: "gemini-3.5-flash", quality: 0.9, coding: 0.9, cost: 0.5, speed: 0.8 },
    ];
    const { currentIds } = curate(models, metrics, accessibleAll);
    expect(currentIds.has("gemini-3.5-flash")).toBe(true);
    expect(currentIds.has("gpt-3.5-turbo")).toBe(false);
  });

  it("collapses dated pins to the undated representative", () => {
    const models = [
      { id: "gpt-4o", modality: "llm" },
      { id: "gpt-4o-2024-08-06", modality: "llm" },
      { id: "gpt-4o-2024-11-20", modality: "llm" },
    ];
    const metrics: ModelMetrics[] = [
      { model_id: "gpt-4o-2024-08-06", quality: 0.5, coding: 0.5, cost: 0.5, speed: 0.5 },
    ];
    const { currentIds } = curate(models, metrics, accessibleAll);
    expect([...currentIds]).toEqual(["gpt-4o"]); // only the clean alias survives
  });

  it("keeps EU and US residency variants as distinct current entries", () => {
    const models = [
      { id: "claude-sonnet-4-5-20250929", modality: "llm" },
      { id: "claude-sonnet-4-5-eu", modality: "llm" },
    ];
    const metrics: ModelMetrics[] = [
      { model_id: "claude-sonnet-4-5-20250929", quality: 0.8, coding: 0.8, cost: 0.5, speed: 0.6 },
    ];
    const { currentIds } = curate(models, metrics, accessibleAll);
    expect(currentIds.has("claude-sonnet-4-5-eu")).toBe(true);
    expect(currentIds.has("claude-sonnet-4-5-20250929")).toBe(true);
  });

  it("uses accessibility (not quality) for audio modalities", () => {
    const models = [
      { id: "tts-hd", modality: "tts" },
      { id: "tts-legacy", modality: "tts" },
    ];
    const { currentIds } = curate(models, [], (id) => id === "tts-hd");
    expect(currentIds.has("tts-hd")).toBe(true);
    expect(currentIds.has("tts-legacy")).toBe(false);
  });
});
