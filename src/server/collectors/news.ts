const SIXTY_DAYS_SECS = 60 * 24 * 3600;

// Known major AI providers — models from these are marked "reasonable" in the feed.
const REASONABLE_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "google",
  "meta-llama",
  "mistralai",
  "deepseek",
  "qwen",
  "minimax",
  "moonshot",
  "thudm",
  "cohere",
  "microsoft",
  "nvidia",
  "x-ai",
  "01-ai",
  "allenai",
]);

function isReasonable(modelId: string): boolean {
  const prefix = modelId.split("/")[0]?.toLowerCase() ?? "";
  return REASONABLE_PROVIDERS.has(prefix);
}

interface OpenRouterNewsRaw {
  id: string;
  name?: string;
  description?: string;
  created?: number;
}

export interface NewsCollectResult {
  inserted: number;
  skipped: number;
}

/**
 * Fetches recent models from OpenRouter and upserts them as news_item rows.
 * Only models from known providers are marked "reasonable".
 * Only models created in the last 60 days are considered to avoid flooding on first run.
 * The unique index on url deduplicates across runs (ON CONFLICT DO NOTHING).
 */
export async function collectNews(): Promise<NewsCollectResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn("[news] OPENROUTER_API_KEY not set — skipping");
    return { inserted: 0, skipped: 0 };
  }

  let modelList: OpenRouterNewsRaw[] = [];
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (resp.ok) {
      const raw = (await resp.json()) as { data?: OpenRouterNewsRaw[] };
      modelList = raw.data ?? [];
    } else {
      console.warn(`[news] OpenRouter returned ${resp.status}`);
    }
  } catch (err) {
    console.warn(`[news] OpenRouter fetch failed: ${err}`);
  }

  // Limit to recent models to avoid flooding the feed on the first run.
  const cutoffSecs = Math.floor(Date.now() / 1000) - SIXTY_DAYS_SECS;
  const recentModels = modelList.filter(
    (m) => !m.created || m.created >= cutoffSecs,
  );

  // Dynamic import keeps this module safe to import in test environments
  // where DATABASE_URL is unset and postgres() would throw on module load.
  const { upsertNewsItem } = await import("../../db/queries.js");

  let inserted = 0;
  let skipped = 0;

  for (const model of recentModels) {
    const url = `https://openrouter.ai/models/${model.id}`;
    const reasonable = isReasonable(model.id);
    const publishedAt = model.created
      ? new Date(model.created * 1000).toISOString()
      : null;

    const wasInserted = await upsertNewsItem({
      title: model.name ?? model.id,
      url,
      source: "openrouter",
      summary: model.description ?? null,
      published_at: publishedAt,
      reasonable,
    });

    if (wasInserted) inserted++;
    else skipped++;
  }

  console.log(
    `[news] inserted=${inserted} skipped=${skipped} from ${recentModels.length} recent models`,
  );
  return { inserted, skipped };
}
