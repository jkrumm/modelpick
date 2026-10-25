import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CompareManifest } from "~/server/audio/compare";
import { resolveExperiments } from "~/server/audio/experiments";

const manifest: CompareManifest = JSON.parse(
  readFileSync(
    join(process.cwd(), "data", "tts-compare", "manifest.json"),
    "utf8",
  ),
);

describe("tts experiments", () => {
  const views = resolveExperiments(manifest);

  it("resolves every wave-5 sample into exactly one experiment cell", () => {
    const resolved = views.flatMap((v) =>
      v.rows.flatMap((r) => Object.values(r.cells)),
    );
    const wave5 = manifest.samples.filter((s) => s.set === "wave5");
    expect(
      resolved
        .filter(Boolean)
        .map((s) => s?.id)
        .toSorted(),
    ).toEqual(wave5.map((s) => s.id).toSorted());
  });

  it("extracts distinct input texts for the writer-rule and number questions", () => {
    const byId = Object.fromEntries(views.map((v) => [v.experiment.id, v]));
    expect(byId["english"]?.texts).toHaveLength(2);
    expect(byId["numbers"]?.texts).toHaveLength(3);
  });
});
