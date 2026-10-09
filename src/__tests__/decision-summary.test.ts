import { describe, it, expect } from "vitest";
import {
  buildDecisionSummary,
  type DecisionSummaryInput,
} from "../server/bench/decision-summary.js";
import { DECISION_METRIC, suiteMetricName } from "../server/bench/decision-metrics.js";

const AT = "2026-10-09 08:00:00";

function metrics(model: string, over: Record<string, number> = {}) {
  const base: Record<string, number> = {
    [DECISION_METRIC.accuracy]: 1,
    [DECISION_METRIC.brier]: 0.02,
    [DECISION_METRIC.latencyP50Ms]: 200,
    [DECISION_METRIC.costPer1kCallsUsd]: 0.1,
    [DECISION_METRIC.errorRate]: 0,
    [DECISION_METRIC.refusalRate]: 0,
    [suiteMetricName("contact-form-verdict")]: 1,
    ...over,
  };
  return Object.entries(base).map(([metric, value]) => ({
    model_id: model,
    metric,
    value,
    captured_at: AT,
  }));
}

const MODELS = [
  { id: "clef-eu", display_name: "Clef (EU)", provider: "cloudflare" },
  { id: "jev-latest", display_name: "Jev (latest)", provider: "other" },
  { id: "jev-1.13.0", display_name: "Jev 1.13.0", provider: "other" },
];

const INPUT: DecisionSummaryInput = {
  models: MODELS,
  metrics: [
    ...metrics("clef-eu", { [DECISION_METRIC.latencyP50Ms]: 160, [DECISION_METRIC.brier]: 0.04 }),
    ...metrics("jev-latest", { [DECISION_METRIC.brier]: 0.01 }),
  ],
  probes: { "clef-eu": { accessible: true, residency: "unknown" } },
  pick: { model_id: "clef-eu", rationale: "r", env_note: null, decided_at: "2026-10-09" },
  consumers: [
    {
      service: "email-gateway",
      slot: "decision-lane",
      label: "lane",
      model_id: "clef-eu",
      config_ref: "vps/apps/email-gateway/compose.yml:32",
      verified_at: "2026-10-09",
    },
  ],
};

describe("buildDecisionSummary", () => {
  it("ranks benched models with the bench's own ordering and splits off unbenched ones", () => {
    const s = buildDecisionSummary(INPUT);
    expect(s.rows.map((r) => r.model)).toEqual(["jev-latest", "clef-eu"]);
    expect(s.unbenched.map((r) => r.model)).toEqual(["jev-1.13.0"]);
  });

  it("marks the pick and says so when it is not the top row", () => {
    const s = buildDecisionSummary(INPUT);
    expect(s.pick).toMatchObject({ model_id: "clef-eu", displayName: "Clef (EU)" });
    expect(s.rows.find((r) => r.isPick)?.model).toBe("clef-eu");
    expect(s.pickIsNotTop).toBe(true);
  });

  it("does not flag the pick when it tops the ranking", () => {
    const s = buildDecisionSummary({
      ...INPUT,
      pick: { model_id: "jev-latest", rationale: null, env_note: null, decided_at: "2026-10-09" },
    });
    expect(s.pickIsNotTop).toBe(false);
  });

  it("reports EU hosting from the catalog and per-suite accuracy from the metrics", () => {
    const s = buildDecisionSummary(INPUT);
    const clef = s.rows.find((r) => r.model === "clef-eu");
    expect(clef?.region).toBe("eu");
    expect(clef?.accessible).toBe(true);
    expect(clef?.suiteAccuracy).toEqual({ "contact-form-verdict": 1 });
    expect(s.rows.find((r) => r.model === "jev-latest")?.region).toBe("unknown");
  });

  it("takes the newest value per metric when a model was benched twice", () => {
    const s = buildDecisionSummary({
      ...INPUT,
      metrics: [
        ...INPUT.metrics,
        {
          model_id: "clef-eu",
          metric: DECISION_METRIC.latencyP50Ms,
          value: 999,
          captured_at: "2026-10-01 00:00:00",
        },
      ],
    });
    expect(s.rows.find((r) => r.model === "clef-eu")?.latencyP50Ms).toBe(160);
  });

  it("ignores non-decision metrics and carries consumers and suites through", () => {
    const s = buildDecisionSummary({
      ...INPUT,
      metrics: [
        ...INPUT.metrics,
        { model_id: "jev-1.13.0", metric: "ttft_ms", value: 5, captured_at: AT },
      ],
    });
    expect(s.unbenched.map((r) => r.model)).toContain("jev-1.13.0");
    expect(s.consumers).toHaveLength(1);
    expect(s.suites.map((x) => x.id)).toEqual([
      "contact-form-verdict",
      "email-triage",
      "urgency-score",
    ]);
  });

  it("builds an empty summary when nothing has been benched", () => {
    const s = buildDecisionSummary({ ...INPUT, metrics: [] });
    expect(s.rows).toEqual([]);
    expect(s.pickIsNotTop).toBe(false);
    expect(s.measuredAt).toBeNull();
  });
});
