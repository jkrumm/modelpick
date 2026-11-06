import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";
import { syncCatalog } from "../server/iu/catalog-sync.js";

const VANISHED_A = "claude-sonnet-5";
const VANISHED_B = "legacy-unlisted";

const ENV = {
  IU_API_KEY: "k",
  IU_OPENAI_BASE_URL: "https://iu.example/openai",
  IU_ANTHROPIC_BASE_URL: "https://iu.example/anthropic",
  IU_GEMINI_BASE_URL: "https://iu.example/gemini",
  IU_DECISIONS_BASE_URL: "https://iu.example/decisions",
};

const BODIES: Record<string, unknown> = {
  openai: { data: [{ id: "gpt-9", Capabilities: ["ChatCompletion"], Vendor: "OpenAI" }] },
  anthropic: { data: [{ id: "claude-x-1" }] },
  gemini: { models: [{ name: "models/gemini-x" }] },
  decisions: { models: [{ name: "jev-preview" }] },
};

function mockLegs(overrides: Record<string, Response> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const leg = Object.keys(BODIES).find((l) => url.includes(`/${l}/`)) ?? "";
      return overrides[leg] ?? new Response(JSON.stringify(BODIES[leg]), { status: 200 });
    }),
  );
}

let dir: string;
let client: Client;
let db: ReturnType<typeof drizzle<typeof schema>>;
let snapshotPath: string;
const SENTINEL = "// untouched snapshot\n";

const snapshot = () => readFile(snapshotPath, "utf8");
const listedRows = async () =>
  new Map((await db.select().from(schema.models)).map((r) => [r.id, r]));

beforeEach(async () => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  dir = await mkdtemp(join(tmpdir(), "catalog-sync-"));
  client = createClient({ url: `file:${join(dir, "test.db")}` });
  await client.execute(`CREATE TABLE models (
    id text PRIMARY KEY NOT NULL,
    provider text NOT NULL,
    family text,
    modality text NOT NULL,
    display_name text NOT NULL,
    context_window integer,
    iu_listed integer DEFAULT false NOT NULL,
    transport text DEFAULT 'iu' NOT NULL,
    owned_by text,
    legs text,
    created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
  )`);
  db = drizzle(client, { schema });
  await db.insert(schema.models).values([
    { id: VANISHED_A, provider: "anthropic", modality: "llm", display_name: "ref", iu_listed: true },
    { id: VANISHED_B, provider: "other", modality: "llm", display_name: "old", iu_listed: true },
  ]);
  snapshotPath = join(dir, "iu-catalog.ts");
  await writeFile(snapshotPath, SENTINEL);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  client.close();
  await rm(dir, { recursive: true, force: true });
});

describe("syncCatalog", () => {
  it("upserts, flips every vanished id, then writes the snapshot", async () => {
    mockLegs();
    await syncCatalog({ db, snapshotPath });

    const rows = await listedRows();
    expect(rows.get(VANISHED_A)?.iu_listed).toBe(false);
    expect(rows.get(VANISHED_B)?.iu_listed).toBe(false);
    expect(rows.get("gpt-9")).toMatchObject({ modality: "llm", iu_listed: true, legs: "openai" });
    expect(rows.get("jev-preview")).toMatchObject({ modality: "decision", family: "decision" });

    const body = await snapshot();
    expect(body).toContain('"id": "gpt-9"');
    expect(body).toContain('"id": "jev-preview"');
    expect(existsSync(`${snapshotPath}.tmp`)).toBe(false);
  });

  it.each([
    ["a leg errors", { gemini: new Response("nope", { status: 503 }) }],
    ["a leg is empty", { anthropic: new Response(JSON.stringify({ data: [] }), { status: 200 }) }],
  ])("%s: no snapshot write, no DB writes", async (_name, overrides) => {
    mockLegs(overrides);
    await expect(syncCatalog({ db, snapshotPath })).rejects.toThrow();

    expect(await snapshot()).toBe(SENTINEL);
    const rows = await listedRows();
    expect([...rows.keys()].toSorted()).toEqual([VANISHED_A, VANISHED_B].toSorted());
    expect(rows.get(VANISHED_B)?.iu_listed).toBe(true);
  });

  it("a DB failure leaves the snapshot untouched", async () => {
    mockLegs();
    await client.execute("DROP TABLE models");
    await expect(syncCatalog({ db, snapshotPath })).rejects.toThrow();
    expect(await snapshot()).toBe(SENTINEL);
  });

  it("a failure in the delist step rolls the upserts back and leaves the snapshot", async () => {
    mockLegs();
    await client.execute(
      "CREATE TRIGGER no_update BEFORE UPDATE ON models BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    await expect(syncCatalog({ db, snapshotPath })).rejects.toThrow();
    expect(await snapshot()).toBe(SENTINEL);
    expect((await listedRows()).has("gpt-9")).toBe(false);
  });
});
