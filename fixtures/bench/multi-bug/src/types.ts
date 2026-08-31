/** A leaderboard entry. */
export interface Entry {
  name: string;
  score: number;
}

/** A catalogue document. `meta` is absent on documents imported before v3. */
export interface Doc {
  id: string;
  meta?: {
    title?: string;
    tags?: string[];
  };
}

/** A registered plugin. */
export interface Plugin {
  name: string;
  tags: string[];
}

/** Spend tiers, cheapest first. */
export type Tier = "bronze" | "silver" | "gold" | "platinum";
