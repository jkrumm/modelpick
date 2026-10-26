import { describe, it, expect, vi, beforeEach } from "vitest";
import { isClaudeModel, listAnthropicModels, anthropicMessage } from "../server/pick/anthropic.js";


const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => text,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  process.env["IU_ANTHROPIC_BASE_URL"] = "https://iu-test.example/anthropic/v1";
  process.env["IU_API_KEY"] = "test-key";
});

// ── isClaudeModel ────────────────────────────────────────────────────────────

describe("isClaudeModel", () => {
  it("matches claude-* ids", () => {
    expect(isClaudeModel("claude-sonnet-5")).toBe(true);
    expect(isClaudeModel("claude-opus-4-8")).toBe(true);
  });

  it("rejects non-Claude ids", () => {
    expect(isClaudeModel("DeepSeek-V4-Flash")).toBe(false);
    expect(isClaudeModel("glm-5.3-flash")).toBe(false);
  });
});

// ── listAnthropicModels ──────────────────────────────────────────────────────

describe("listAnthropicModels", () => {
  it("extracts ids from a {data: [...]} listing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: [{ id: "claude-sonnet-5" }, { id: "DeepSeek-V4-Flash" }] }),
    );

    const ids = await listAnthropicModels();
    expect(ids).toEqual(["claude-sonnet-5", "DeepSeek-V4-Flash"]);
  });

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "boom" }));
    await expect(listAnthropicModels()).rejects.toThrow(/HTTP 500/);
  });
});

// ── anthropicMessage ─────────────────────────────────────────────────────────

describe("anthropicMessage", () => {
  it("detects a thinking content block", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        content: [
          { type: "thinking", thinking: "..." },
          { type: "text", text: "hi" },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 10 },
      }),
    );

    const res = await anthropicMessage({
      model: "glm-5.3-flash",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.ok).toBe(true);
    expect(res.hasThinking).toBe(true);
    expect(res.stopReason).toBe("end_turn");
  });

  it("surfaces the error message on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: { message: "bad request" } }));

    const res = await anthropicMessage({
      model: "qwen3.7-max",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.ok).toBe(false);
    expect(res.errorText).toBe("bad request");
  });
});
