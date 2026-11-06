import { describe, expect, it, vi } from "vitest";
import {
  iuKey,
  labOfId,
  planReleaseAlerts,
  runReleaseAlerts,
  type ReleaseAlertDeps,
  type RecordKind,
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
  // Both baselines present, so nothing seeds.
  alerted: new Map<string, RecordKind>([
    ["old", "seed"],
    [iuKey("old-iu"), "iu_seed"],
  ]),
};

describe("planReleaseAlerts", () => {
  it("seeds AA lineages and listed IU ids silently on the first run", () => {
    const plan = planReleaseAlerts({
      ...base,
      alerted: new Map(),
      variants: [variant("a", "a"), variant("b", "b", { intelligence: null })],
      models: [model("gpt-9"), model("x", { iu_listed: false }), model("t", { modality: "tts" })],
    });
    expect(plan.alerts).toEqual([]);
    expect(plan.seeds).toEqual([
      { lineage: "a", kind: "seed" },
      { lineage: iuKey("gpt-9"), kind: "iu_seed" },
    ]);
  });

  it("seeds per kind: an AA-seeded DB without IU rows records the IU ids and does not push them", () => {
    const plan = planReleaseAlerts({
      ...base,
      alerted: new Map<string, RecordKind>([["old", "seed"]]),
      variants: [variant("fresh", "fresh")],
      models: [model("gpt-9"), model("claude-9")],
    });
    expect(plan.seeds).toEqual([
      { lineage: iuKey("gpt-9"), kind: "iu_seed" },
      { lineage: iuKey("claude-9"), kind: "iu_seed" },
    ]);
    // the AA side still runs in the same pass
    expect(plan.alerts.map((a) => [a.lineage, a.kind])).toEqual([["fresh", "aa"]]);
  });

  it("alerts a big-lab lineage at intelligence >= 30 once, collapsing effort variants", () => {
    const plan = planReleaseAlerts({
      ...base,
      variants: [
        variant("new-1", "new-1", { intelligence: 45, cost_per_task: 1 }),
        variant("new-1-low", "new-1", { effort: "low", intelligence: 31, cost_per_task: 0.1 }),
        variant("old", "old", { intelligence: 20 }),
      ],
      models: [model("new.1", { id: "new.1" })],
      probes: new Map([["new.1", true]]),
      alerted: new Map<string, RecordKind>([...base.alerted, [iuKey("new.1"), "iu_seed"]]),
    });
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0]).toMatchObject({ lineage: "new-1", kind: "aa" });
    const msg = plan.alerts[0]!.push.message;
    expect(msg).toContain("intelligence 45");
    expect(msg).toContain("$0.100 - $1.00");
    expect(msg).toContain("~200k tokens/task");
    expect(msg).toContain("IU callable: yes");
  });

  it("alerts a small lab only when it sits on the Pareto frontier, and records no skip", () => {
    const plan = planReleaseAlerts({
      ...base,
      variants: [
        variant("big", "big", { creator: "Acme", intelligence: 50, cost_per_task: 1 }),
        variant("cheap", "cheap", { creator: "Acme", intelligence: 20, cost_per_task: 0.01 }),
        variant("meh", "meh", { creator: "Acme", intelligence: 19, cost_per_task: 0.5 }),
      ],
    });
    expect(plan.alerts.map((a) => a.lineage).toSorted()).toEqual(["big", "cheap"]);
    expect(plan.seeds).toEqual([]);
  });

  it("says IU callable: no when the lineage has no catalog id", () => {
    const plan = planReleaseAlerts({ ...base, variants: [variant("x", "x")] });
    expect(plan.alerts[0]!.push.message).toContain("IU callable: no");
  });

  it("skips lineages already recorded", () => {
    const alerted = new Map<string, RecordKind>([...base.alerted, ["x", "aa"]]);
    expect(planReleaseAlerts({ ...base, alerted, variants: [variant("x", "x")] }).alerts).toEqual([]);
  });

  it("alerts a listed IU id of a followed lab, not a residency twin, unlisted, non-llm or AA-covered id", () => {
    const plan = planReleaseAlerts({
      ...base,
      models: [
        model("claude-9"),
        model("claude-9-eu"),
        model("llama-9"),
        model("zzz-1"),
        model("kimi-3", { modality: "tts" }),
        model("qwen-9", { iu_listed: false }),
      ],
      probes: new Map([["claude-9", true]]),
    });
    expect(plan.alerts.map((a) => a.lineage)).toEqual([iuKey("llama-9"), iuKey("claude-9")]);
    expect(plan.alerts.find((a) => a.lineage === iuKey("claude-9"))!.push.message).toContain("IU callable: yes");
    expect(plan.alerts.find((a) => a.lineage === iuKey("llama-9"))!.push.message).toContain("IU callable: no");
  });

  it("does not push an IU id whose AA lineage already alerted", () => {
    const plan = planReleaseAlerts({
      ...base,
      variants: [variant("gpt-9", "gpt-9")],
      models: [model("gpt-9")],
    });
    expect(plan.alerts.map((a) => a.kind)).toEqual(["aa"]);
  });

  it("words an IU id with a scored AA lineage as now on IU, with its intelligence", () => {
    const plan = planReleaseAlerts({
      ...base,
      alerted: new Map<string, RecordKind>([...base.alerted, ["gpt-9", "seed"]]),
      variants: [variant("gpt-9", "gpt-9", { intelligence: 47 })],
      models: [model("gpt-9"), model("llama-9")],
    });
    const byId = new Map(plan.alerts.map((a) => [a.lineage, a.push]));
    expect(byId.get(iuKey("gpt-9"))?.title).toBe("Now on IU: gpt-9");
    expect(byId.get(iuKey("gpt-9"))?.message).toContain("intelligence 47");
    expect(byId.get(iuKey("gpt-9"))?.message).not.toContain("no AA score yet");
    expect(byId.get(iuKey("llama-9"))?.message).toContain("no AA score yet");
  });

  it("maps ids to labs", () => {
    expect(labOfId("gpt-6.1-terra")).toBe("OpenAI");
    expect(labOfId("deepseek-v4.1-flash")).toBe("DeepSeek");
    expect(labOfId("glm-5.3")).toBe("Z AI");
    expect(labOfId("sonar")).toBeNull();
  });
});

/** An in-memory release_alert plus the rows the plan reads, to replay several days. */
function simulate(opts: { variants: () => AaVariant[]; models?: () => Model[]; publish: ReleaseAlertDeps["publish"] }) {
  const table = new Map<string, RecordKind>();
  const deps: ReleaseAlertDeps = {
    load: async () => ({
      variants: opts.variants(),
      models: opts.models?.() ?? [],
      probes: new Map(),
      alerted: new Map(table),
    }),
    record: async (rows) => {
      for (const r of rows) table.set(r.lineage, r.kind);
    },
    publish: opts.publish,
  };
  return { table, run: () => runReleaseAlerts({ deps }) };
}

describe("runReleaseAlerts", () => {
  it("seeds on the first run and then is a no-op", async () => {
    const pub = vi.fn().mockResolvedValue("sent");
    const sim = simulate({
      variants: () => [variant("a", "a"), variant("b", "b")],
      models: () => [model("gpt-9")],
      publish: pub,
    });
    expect(await sim.run()).toEqual({ seeded: true, published: 0, failed: 0 });
    expect([...sim.table.values()].toSorted()).toEqual(["iu_seed", "seed", "seed"]);
    expect(await sim.run()).toEqual({ seeded: false, published: 0, failed: 0 });
    expect(pub).not.toHaveBeenCalled();
  });

  it("retries a failed publish the next day, for AA and IU candidates alike", async () => {
    const pub = vi
      .fn()
      .mockRejectedValueOnce(new Error("ntfy 500"))
      .mockRejectedValueOnce(new Error("ntfy 500"))
      .mockResolvedValue("sent");
    let day2 = false;
    const sim = simulate({
      variants: () => (day2 ? [variant("a", "a"), variant("new", "new")] : [variant("a", "a")]),
      models: () => (day2 ? [model("llama-1"), model("llama-9")] : [model("llama-1")]),
      publish: pub,
    });
    await sim.run(); // seed
    day2 = true;
    expect(await sim.run()).toEqual({ seeded: false, published: 0, failed: 2 });
    expect(sim.table.has("new")).toBe(false);
    expect(sim.table.has(iuKey("llama-9"))).toBe(false);
    expect(await sim.run()).toEqual({ seeded: false, published: 2, failed: 0 });
    expect(sim.table.get("new")).toBe("aa");
    expect(sim.table.get(iuKey("llama-9"))).toBe("iu");
    expect(await sim.run()).toEqual({ seeded: false, published: 0, failed: 0 });
  });

  it("pushes a lineage that is weak on day 1 and strong on day 3, exactly once", async () => {
    const pub = vi.fn().mockResolvedValue("sent");
    let day = 1;
    const sim = simulate({
      variants: () => [
        variant("anchor", "anchor", { intelligence: 60, cost_per_task: 0.01 }),
        variant("late", "late", { intelligence: day >= 3 ? 45 : 12, cost_per_task: 5 }),
      ],
      publish: pub,
    });
    await sim.run(); // seed: both lineages known
    sim.table.delete("late"); // late appears after the seed
    for (day = 1; day <= 4; day++) await sim.run();
    expect(pub).toHaveBeenCalledTimes(1);
    expect(pub.mock.calls[0]![0].title).toContain("late");
    expect(sim.table.has("late")).toBe(true);
  });

  it("records nothing for a dry or skipped publish, so it retries", async () => {
    const sim = simulate({
      variants: () => [variant("a", "a")],
      publish: async () => "dry",
    });
    await sim.run();
    sim.table.set("other", "aa");
    sim.table.delete("a");
    expect(await sim.run()).toEqual({ seeded: false, published: 0, failed: 0 });
    expect(sim.table.has("a")).toBe(false);
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
