import { describe, expect, it, vi } from "vitest";
import {
  labOfId,
  planReleaseAlerts,
  runReleaseAlerts,
  type ReleaseAlertDeps,
  type RecordRow,
} from "../server/alerts/releases.js";
import { publish } from "../server/alerts/ntfy.js";
import type { AaVariant, Model } from "../db/schema.js";

const variant = (slug: string, lineage: string, extra: Partial<AaVariant> = {}): AaVariant => ({
  slug,
  name: `${lineage} (Max)`,
  lineage,
  effort: "max",
  creator: "OpenAI",
  release_date: "2026-11-01",
  intelligence: 40,
  cost_per_task: 0.5,
  price_in: 1,
  price_out: 5,
  price_cache_read: null,
  price_cache_write: null,
  tps: 80,
  ttft_sec: 1,
  ttfat_sec: 1,
  e2e_sec: 10,
  first_seen_at: "2026-11-01",
  updated_at: "2026-11-06",
  ...extra,
});

const model = (id: string, extra: Partial<Model> = {}): Model => ({
  id,
  provider: "x",
  family: null,
  modality: "llm",
  display_name: id,
  context_window: null,
  iu_listed: true,
  transport: "iu",
  owned_by: null,
  legs: "openai",
  created_at: "2026-11-01",
  ...extra,
});

const base = {
  variants: [] as AaVariant[],
  models: [] as Model[],
  probes: new Map<string, boolean>(),
  alerted: new Set<string>(["old"]),
  added: [] as string[],
};

describe("planReleaseAlerts", () => {
  it("records everything silently on the first run", () => {
    const plan = planReleaseAlerts({
      ...base,
      alerted: new Set(),
      variants: [variant("a", "a"), variant("b", "b", { intelligence: null })],
      added: ["gpt-9"],
    });
    expect(plan.alerts).toEqual([]);
    expect(plan.silent).toEqual([
      { lineage: "a", kind: "seed" },
      { lineage: "gpt-9", kind: "seed" },
    ]);
  });

  it("alerts a big-lab lineage at intelligence >= 30 once, collapsing effort variants", () => {
    const plan = planReleaseAlerts({
      ...base,
      variants: [
        variant("new-1", "new-1", { intelligence: 45, cost_per_task: 1 }),
        variant("new-1-low", "new-1", { effort: "low", intelligence: 31, cost_per_task: 0.1 }),
        // dominated by new-1-low on both axes, so only the lab rule can fire
        variant("old", "old", { intelligence: 20 }),
      ],
      models: [model("new.1")],
      probes: new Map([["new.1", true]]),
    });
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0]).toMatchObject({ lineage: "new-1", kind: "aa" });
    const msg = plan.alerts[0]!.push.message;
    expect(msg).toContain("intelligence 45");
    expect(msg).toContain("$0.100 - $1.00");
    expect(msg).toContain("~200k tokens/task");
    expect(msg).toContain("IU callable: yes");
  });

  it("alerts a small lab only when it sits on the Pareto frontier", () => {
    const plan = planReleaseAlerts({
      ...base,
      variants: [
        variant("big", "big", { creator: "Acme", intelligence: 50, cost_per_task: 1 }),
        variant("cheap", "cheap", { creator: "Acme", intelligence: 20, cost_per_task: 0.01 }),
        variant("meh", "meh", { creator: "Acme", intelligence: 19, cost_per_task: 0.5 }),
      ],
    });
    expect(plan.alerts.map((a) => a.lineage).toSorted()).toEqual(["big", "cheap"]);
    expect(plan.silent).toEqual([{ lineage: "meh", kind: "skip" }]);
  });

  it("says IU callable: no when the lineage has no catalog id", () => {
    const plan = planReleaseAlerts({ ...base, variants: [variant("x", "x")] });
    expect(plan.alerts[0]!.push.message).toContain("IU callable: no");
  });

  it("skips lineages already recorded", () => {
    const plan = planReleaseAlerts({ ...base, alerted: new Set(["x"]), variants: [variant("x", "x")] });
    expect(plan).toEqual({ alerts: [], silent: [] });
  });

  it("alerts a new IU id of a followed lab, not a residency twin or an AA-covered id", () => {
    const plan = planReleaseAlerts({
      ...base,
      models: [
        model("claude-9"),
        model("claude-9-eu"),
        model("gpt-5"),
        model("gpt-5-eu"),
        model("llama-9"),
        model("zzz-1"),
        model("kimi-3", { modality: "tts" }),
      ],
      probes: new Map([["claude-9", true]]),
      added: ["claude-9", "claude-9-eu", "gpt-5-eu", "llama-9", "zzz-1", "kimi-3"],
    });
    expect(plan.alerts.map((a) => a.lineage)).toEqual(["llama-9", "claude-9"].toSorted((a, b) => a.length - b.length || a.localeCompare(b)));
    expect(plan.alerts.find((a) => a.lineage === "claude-9")!.push.message).toContain("IU callable: yes");
    expect(plan.alerts.find((a) => a.lineage === "llama-9")!.push.message).toContain("IU callable: no");
  });

  it("does not push an IU id whose AA lineage already alerted", () => {
    const plan = planReleaseAlerts({
      ...base,
      variants: [variant("gpt-9", "gpt-9")],
      models: [model("gpt-9")],
      added: ["gpt-9"],
    });
    expect(plan.alerts.map((a) => a.kind)).toEqual(["aa"]);
  });

  it("maps ids to labs", () => {
    expect(labOfId("gpt-6.1-terra")).toBe("OpenAI");
    expect(labOfId("deepseek-v4.1-flash")).toBe("DeepSeek");
    expect(labOfId("glm-5.3")).toBe("Z AI");
    expect(labOfId("sonar")).toBeNull();
  });
});

describe("runReleaseAlerts", () => {
  const makeDeps = (alerted: string[], publishImpl: ReleaseAlertDeps["publish"]) => {
    const recorded: RecordRow[] = [];
    const deps: ReleaseAlertDeps = {
      load: async () => ({
        ...base,
        alerted: new Set(alerted),
        variants: [variant("a", "a"), variant("b", "b")],
      }),
      record: async (rows) => void recorded.push(...rows),
      publish: publishImpl,
    };
    return { deps, recorded };
  };

  it("seeds on the first run and then is a no-op", async () => {
    const pub = vi.fn().mockResolvedValue("sent");
    const first = makeDeps([], pub);
    expect(await runReleaseAlerts({ added: [], deps: first.deps })).toEqual({ seeded: true, published: 0, failed: 0 });
    expect(first.recorded.map((r) => r.kind)).toEqual(["seed", "seed"]);

    const second = makeDeps(first.recorded.map((r) => r.lineage), pub);
    expect(await runReleaseAlerts({ added: [], deps: second.deps })).toEqual({ seeded: false, published: 0, failed: 0 });
    expect(pub).not.toHaveBeenCalled();
    expect(second.recorded).toEqual([]);
  });

  it("records only the lineages whose publish succeeded and counts failures", async () => {
    const pub = vi.fn().mockRejectedValueOnce(new Error("ntfy 500")).mockResolvedValue("sent");
    const { deps, recorded } = makeDeps(["old"], pub);
    const summary = await runReleaseAlerts({ added: [], deps });
    expect(summary).toEqual({ seeded: false, published: 1, failed: 1 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.kind).toBe("aa");
  });

  it("records nothing for a dry or skipped publish, so it retries", async () => {
    const { deps, recorded } = makeDeps(["old"], async () => "dry");
    expect(await runReleaseAlerts({ added: [], deps })).toEqual({ seeded: false, published: 0, failed: 0 });
    expect(recorded).toEqual([]);
  });
});

describe("publish", () => {
  it("prints in dry mode and skips quietly without NTFY_URL", async () => {
    vi.stubEnv("MODELPICK_NOTIFY_DRY", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await publish({ title: "t", message: "m", priority: "default", tags: [] })).toBe("dry");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    vi.stubEnv("MODELPICK_NOTIFY_DRY", "");
    vi.stubEnv("NTFY_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await publish({ title: "t", message: "m", priority: "default", tags: [] })).toBe("skipped");
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});
