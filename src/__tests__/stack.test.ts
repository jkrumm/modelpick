import { describe, it, expect } from "vitest";
import { deriveFlags, STALE_AFTER_DAYS } from "../routes/-stack-server-fns";
import type { DeriveFlagsInput } from "../routes/-stack-server-fns";

const BASE: DeriveFlagsInput = {
  hasModel: true,
  probeAccessible: true,
  category: null,
  followsRecommendation: true,
  modelId: "claude-sonnet-5",
  algoModelId: null,
  verifiedAt: "2026-09-01",
  today: "2026-09-12",
};

describe("deriveFlags", () => {
  // A slot can name a category for grouping and deliberately not follow its
  // recommendation — a Max-plan slot where cost is free, or a residency-gated
  // one. Flagging those as drift lit up 28 of 54 slots, which is noise.
  it("does not flag drift when the slot deliberately does not follow its category", () => {
    const flags = deriveFlags({
      ...BASE,
      category: "coding",
      followsRecommendation: false,
      algoModelId: "glm-5.3-flash",
    });
    expect(flags).not.toContain("drift");
  });

  it("still flags drift when the slot does follow its category", () => {
    const flags = deriveFlags({
      ...BASE,
      category: "coding",
      followsRecommendation: true,
      algoModelId: "glm-5.3-flash",
    });
    expect(flags).toContain("drift");
  });

  it("returns no flags for a clean, recently verified, non-drifting slot", () => {
    expect(deriveFlags(BASE)).toEqual([]);
  });

  it("flags unresolvable when the model has no catalog row", () => {
    const flags = deriveFlags({ ...BASE, hasModel: false, probeAccessible: false });
    expect(flags).toContain("unresolvable");
    // unresolvable and inaccessible are mutually exclusive
    expect(flags).not.toContain("inaccessible");
  });

  it("flags inaccessible only when a probe exists and says not accessible", () => {
    expect(deriveFlags({ ...BASE, probeAccessible: false })).toContain("inaccessible");
    // never probed (null) is absence of evidence, not evidence
    expect(deriveFlags({ ...BASE, probeAccessible: null })).not.toContain("inaccessible");
  });

  it("flags drift when the category's algo pick disagrees with the deployed model", () => {
    const flags = deriveFlags({
      ...BASE,
      category: "coding",
      algoModelId: "gpt-5.6-astra",
      modelId: "claude-sonnet-5",
    });
    expect(flags).toContain("drift");
  });

  it("does not flag drift for a structural slot with no category", () => {
    const flags = deriveFlags({
      ...BASE,
      category: null,
      algoModelId: "gpt-5.6-astra",
      modelId: "claude-sonnet-5",
    });
    expect(flags).not.toContain("drift");
  });

  it("does not flag drift when the algo pick agrees", () => {
    const flags = deriveFlags({
      ...BASE,
      category: "coding",
      algoModelId: "claude-sonnet-5",
      modelId: "claude-sonnet-5",
    });
    expect(flags).not.toContain("drift");
  });

  it("flags stale when verified_at is null", () => {
    expect(deriveFlags({ ...BASE, verifiedAt: null })).toContain("stale");
  });

  it(`flags stale when verified_at is older than ${STALE_AFTER_DAYS} days`, () => {
    const flags = deriveFlags({ ...BASE, verifiedAt: "2026-01-01", today: "2026-09-12" });
    expect(flags).toContain("stale");
  });

  it("does not flag stale within the freshness window", () => {
    const flags = deriveFlags({ ...BASE, verifiedAt: "2026-09-01", today: "2026-09-12" });
    expect(flags).not.toContain("stale");
  });
});
