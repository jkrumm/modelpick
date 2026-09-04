import { describe, it, expect } from "vitest";
import {
  formatMetricValue,
  metricKey,
  metricLabel,
  MISSING,
  parseMetricKey,
  sourceLabel,
} from "../routes/-benchmarks-format";

// ── -benchmarks-format.ts (pure, DB-free) ─────────────────────────────────────

describe("metricKey / parseMetricKey", () => {
  it("round-trips a (source, metric) pair", () => {
    const key = metricKey("artificialanalysis", "coding_index");
    expect(parseMetricKey(key)).toEqual({ source: "artificialanalysis", metric: "coding_index" });
  });

  it("handles a metric name that itself contains an underscore-heavy name", () => {
    const key = metricKey("live", "tool_call_coverage");
    expect(parseMetricKey(key)).toEqual({ source: "live", metric: "tool_call_coverage" });
  });
});

describe("metricLabel", () => {
  it("uses the override table for known short-form benchmark names", () => {
    expect(metricLabel("ttft_ms")).toBe("TTFT");
    expect(metricLabel("mmlu_pro")).toBe("MMLU-Pro");
    expect(metricLabel("terminalbench_hard")).toBe("TB Hard");
  });

  it("falls back to snake_case -> Title Case for an unknown metric", () => {
    expect(metricLabel("some_future_eval")).toBe("Some Future Eval");
    expect(metricLabel("throughput")).toBe("Throughput");
  });
});

describe("sourceLabel", () => {
  it("labels known sources", () => {
    expect(sourceLabel("artificialanalysis")).toBe("ArtificialAnalysis");
    expect(sourceLabel("openrouter")).toBe("OpenRouter");
    expect(sourceLabel("live")).toBe("Live probe");
  });

  it("falls back to the raw source name when unknown", () => {
    expect(sourceLabel("some_new_source")).toBe("some_new_source");
  });
});

describe("formatMetricValue", () => {
  it("formats a non-finite value as the missing dash", () => {
    expect(formatMetricValue("quality", Number.NaN)).toBe(MISSING);
  });

  it("formats price-family metrics as a dollar rate, from either source", () => {
    expect(formatMetricValue("price_in", 0.15)).toBe("$0.150");
    expect(formatMetricValue("price_out", 12.5)).toBe("$12.50");
  });

  it("formats context_window compactly", () => {
    expect(formatMetricValue("context_window", 1_310_720)).toBe("1.3M");
    expect(formatMetricValue("context_window", 4095)).toBe("4.1k");
  });

  it("formats release_date (unix seconds) as an ISO date", () => {
    expect(formatMetricValue("release_date", 1_735_689_600)).toBe("2025-01-01");
  });

  it("formats ttft_ms (live, milliseconds) with a duration unit, not a raw fraction", () => {
    expect(formatMetricValue("ttft_ms", 850)).toBe("850ms");
    expect(formatMetricValue("ttft_ms", 8_711)).toBe("8.7s");
  });

  it("formats latency_p50 (AA, seconds) with an 's' suffix, never as milliseconds", () => {
    expect(formatMetricValue("latency_p50", 7.41)).toBe("7.41s");
  });

  it("formats throughput as tokens/sec", () => {
    expect(formatMetricValue("throughput", 187.4)).toBe("187 tok/s");
  });

  it("formats tool_call_rounds as a plain one-decimal count", () => {
    expect(formatMetricValue("tool_call_rounds", 2.823529)).toBe("2.8");
  });

  it("reads an unrecognized metric's own scale: 0-1 as a fraction, else a raw score", () => {
    // AA's pass-rate style evals (mmlu_pro, gpqa, tau2, ...) report 0-1.
    expect(formatMetricValue("gpqa", 0.759)).toBe("76%");
    // AA's index scores (quality/coding_index/math_index) report 0-100.
    expect(formatMetricValue("coding_index", 45.8)).toBe("45.8");
    expect(formatMetricValue("quality", 28.76)).toBe("28.8");
  });

  it("never renders a real zero as the missing dash", () => {
    expect(formatMetricValue("price_in", 0)).not.toBe(MISSING);
    expect(formatMetricValue("gpqa", 0)).not.toBe(MISSING);
  });
});

// ── matrix helpers replicated from routes/benchmarks.tsx (pure functions) ────
// Mirrors the convention in ui.test.ts: route components stay untested-by-import
// (JSX + Mantine at module scope), the logic they contain is exercised here
// against the same fixtures shape (BenchmarkModelRow).

interface Row {
  model_id: string;
  display_name: string;
  provider: string;
  modality: string;
  accessible: boolean;
  metrics: Record<string, number>;
}

interface Column {
  key: string;
  source: string;
  metric: string;
}

const SOURCE_ORDER = ["iu", "openrouter", "artificialanalysis", "live"];

function discoverColumns(rows: Row[]): Column[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.metrics)) keys.add(key);
  }
  const columns = [...keys].map((key) => ({ key, ...parseMetricKey(key) }));
  const sourceOrder = new Map(SOURCE_ORDER.map((s, i) => [s, i]));
  columns.sort((a, b) => {
    const oa = sourceOrder.get(a.source) ?? SOURCE_ORDER.length;
    const ob = sourceOrder.get(b.source) ?? SOURCE_ORDER.length;
    if (oa !== ob) return oa - ob;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.metric.localeCompare(b.metric);
  });
  return columns;
}

function coverageOf(rows: Row[], key: string): number {
  let n = 0;
  for (const row of rows) if (row.metrics[key] !== undefined) n++;
  return n;
}

function filterRows(
  rows: Row[],
  filter: { search: string; currentOnly: boolean; iuOnly: boolean; currentIds: Set<string> },
): Row[] {
  const q = filter.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter.currentOnly && !filter.currentIds.has(r.model_id)) return false;
    if (filter.iuOnly && !r.accessible) return false;
    if (q.length > 0) {
      if (!r.display_name.toLowerCase().includes(q) && !r.provider.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}

function sortRows(rows: Row[], field: string, dir: "asc" | "desc"): Row[] {
  function fieldValue(row: Row): string | number | undefined {
    if (field === "display_name") return row.display_name;
    if (field === "provider") return row.provider;
    return row.metrics[field];
  }
  return rows.toSorted((a, b) => {
    const av = fieldValue(a);
    const bv = fieldValue(b);
    if (av === undefined && bv === undefined) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    const cmp =
      typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return dir === "asc" ? cmp : -cmp;
  });
}

function sharedColumns(rows: Row[], allColumns: Column[]): Column[] {
  if (rows.length < 2) return [];
  return allColumns.filter((col) => rows.every((r) => r.metrics[col.key] !== undefined));
}

const rows: Row[] = [
  {
    model_id: "model-a",
    display_name: "Model A",
    provider: "anthropic",
    modality: "llm",
    accessible: true,
    metrics: { "artificialanalysis::quality": 60, "artificialanalysis::gpqa": 0.8 },
  },
  {
    model_id: "model-b",
    display_name: "Model B",
    provider: "openai",
    modality: "llm",
    accessible: false,
    metrics: { "artificialanalysis::quality": 40, "live::ttft_ms": 500 },
  },
  {
    model_id: "model-c",
    display_name: "Model C",
    provider: "deepseek",
    modality: "llm",
    accessible: true,
    metrics: {},
  },
];

describe("discoverColumns", () => {
  it("finds every distinct (source, metric) pair present, grouped and sorted by source order", () => {
    const columns = discoverColumns(rows);
    expect(columns.map((c) => c.key)).toEqual([
      "artificialanalysis::gpqa",
      "artificialanalysis::quality",
      "live::ttft_ms",
    ]);
  });

  it("produces no columns for an empty dataset", () => {
    expect(discoverColumns([])).toEqual([]);
  });
});

describe("coverageOf", () => {
  it("counts only rows that actually have a value, not zeros or all rows", () => {
    expect(coverageOf(rows, "artificialanalysis::quality")).toBe(2);
    expect(coverageOf(rows, "artificialanalysis::gpqa")).toBe(1);
    expect(coverageOf(rows, "does::notexist")).toBe(0);
  });
});

describe("filterRows", () => {
  it("filters by search across display name and provider", () => {
    const out = filterRows(rows, {
      search: "openai",
      currentOnly: false,
      iuOnly: false,
      currentIds: new Set(),
    });
    expect(out.map((r) => r.model_id)).toEqual(["model-b"]);
  });

  it("filters to IU-accessible models only", () => {
    const out = filterRows(rows, {
      search: "",
      currentOnly: false,
      iuOnly: true,
      currentIds: new Set(),
    });
    expect(out.map((r) => r.model_id)).toEqual(["model-a", "model-c"]);
  });

  it("filters to the curated current-id set", () => {
    const out = filterRows(rows, {
      search: "",
      currentOnly: true,
      iuOnly: false,
      currentIds: new Set(["model-b"]),
    });
    expect(out.map((r) => r.model_id)).toEqual(["model-b"]);
  });
});

describe("sortRows", () => {
  it("sorts by a benchmark column, missing values always last", () => {
    const out = sortRows(rows, "artificialanalysis::quality", "desc");
    expect(out.map((r) => r.model_id)).toEqual(["model-a", "model-b", "model-c"]);
  });

  it("sorts ascending by a fixed text column", () => {
    const out = sortRows(rows, "display_name", "asc");
    expect(out.map((r) => r.model_id)).toEqual(["model-a", "model-b", "model-c"]);
  });
});

describe("sharedColumns (the cross-benchmark join)", () => {
  it("returns only benchmarks every pinned model has a value for", () => {
    const columns = discoverColumns(rows);
    const pinned = [rows[0], rows[1]] as Row[];
    expect(sharedColumns(pinned, columns).map((c) => c.key)).toEqual([
      "artificialanalysis::quality",
    ]);
  });

  it("returns nothing for a single pinned model — a join needs two sides", () => {
    const columns = discoverColumns(rows);
    expect(sharedColumns([rows[0] as Row], columns)).toEqual([]);
  });

  it("returns nothing when pinned models share no benchmark at all", () => {
    const columns = discoverColumns(rows);
    const pinned = [rows[0], rows[2]] as Row[]; // model-c has zero metrics
    expect(sharedColumns(pinned, columns)).toEqual([]);
  });
});
