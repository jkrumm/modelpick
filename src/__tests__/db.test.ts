import { describe, it, expect } from "vitest";
import {
  modalityEnum,
  residencyEnum,
  categoryEnum,
  langEnum,
  metricSourceEnum,
  models,
  capabilityProbe,
  metricSnapshot,
  recommendation,
  demo,
  newsItem,
} from "../db/schema.js";
import { IU_CATALOG } from "../db/iu-catalog.js";

describe("schema enum values", () => {
  it("modality has correct values", () => {
    expect(modalityEnum.enumValues).toEqual(["llm", "tts", "stt", "image", "embedding"]);
  });

  it("residency has correct values", () => {
    expect(residencyEnum.enumValues).toEqual(["eu", "us", "unknown"]);
  });

  it("category has correct values", () => {
    expect(categoryEnum.enumValues).toEqual(["fast", "coding", "orchestrator", "tts", "stt"]);
  });

  it("lang has correct values", () => {
    expect(langEnum.enumValues).toEqual(["de", "en"]);
  });

  it("metric source has correct values", () => {
    expect(metricSourceEnum.enumValues).toEqual(["iu", "openrouter", "artificialanalysis"]);
  });
});

describe("schema table definitions", () => {
  it("models table has expected columns", () => {
    const cols = Object.keys(models);
    expect(cols).toContain("id");
    expect(cols).toContain("provider");
    expect(cols).toContain("modality");
    expect(cols).toContain("display_name");
  });

  it("capability_probe table has expected columns", () => {
    const cols = Object.keys(capabilityProbe);
    expect(cols).toContain("model_id");
    expect(cols).toContain("accessible");
    expect(cols).toContain("residency");
    expect(cols).toContain("latency_ms");
  });

  it("metric_snapshot table has expected columns", () => {
    const cols = Object.keys(metricSnapshot);
    expect(cols).toContain("model_id");
    expect(cols).toContain("source");
    expect(cols).toContain("metric");
    expect(cols).toContain("value");
    expect(cols).toContain("confidence");
  });

  it("recommendation table has expected columns", () => {
    const cols = Object.keys(recommendation);
    expect(cols).toContain("category");
    expect(cols).toContain("model_id");
    expect(cols).toContain("score");
    expect(cols).toContain("rationale");
    expect(cols).toContain("snapshot_date");
  });

  it("demo table has expected columns", () => {
    const cols = Object.keys(demo);
    expect(cols).toContain("modality");
    expect(cols).toContain("model_id");
    expect(cols).toContain("text_content");
    expect(cols).toContain("lang");
    expect(cols).toContain("audio_path");
    expect(cols).toContain("public");
  });

  it("news_item table has expected columns", () => {
    const cols = Object.keys(newsItem);
    expect(cols).toContain("title");
    expect(cols).toContain("url");
    expect(cols).toContain("source");
    expect(cols).toContain("reasonable");
  });
});

describe("IU catalog", () => {
  it("is non-empty and spans the expected modalities", () => {
    expect(IU_CATALOG.length).toBeGreaterThan(50);
    const modalities = new Set(IU_CATALOG.map((m) => m.modality));
    expect(modalities.has("llm")).toBe(true);
    expect(modalities.has("tts")).toBe(true);
    expect(modalities.has("stt")).toBe(true);
    expect(modalities.has("image")).toBe(true);
    expect(modalities.has("embedding")).toBe(true);
  });

  it("all entries have required fields", () => {
    for (const m of IU_CATALOG) {
      expect(m.id).toBeTruthy();
      expect(m.provider).toBeTruthy();
      expect(m.modality).toBeTruthy();
      expect(m.display_name).toBeTruthy();
    }
  });

  it("has no duplicate ids", () => {
    const ids = IU_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains known IU catalog models", () => {
    const ids = new Set(IU_CATALOG.map((m) => m.id));
    expect(ids.has("gpt-image-1")).toBe(true);
    expect(ids.has("gpt-4o-transcribe")).toBe(true);
    expect(ids.has("claude-opus-4-5-20251101")).toBe(true);
  });
});
