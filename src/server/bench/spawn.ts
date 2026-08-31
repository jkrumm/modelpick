/**
 * Spawning `claude -p` against the IU Anthropic route.
 *
 * The exact invocation below was measured, not guessed, and every part of it is
 * load-bearing:
 *
 *  - `ANTHROPIC_API_KEY` must be **unset**, not empty — claude v2.x rejects an
 *    empty one with "Not logged in". `ANTHROPIC_AUTH_TOKEN` is the working door.
 *  - All four `ANTHROPIC_DEFAULT_*_MODEL` tiers pin to the same gateway id, or a
 *    spawned subagent asks the gateway for a `claude-*` default it does not
 *    serve and the turn 400s.
 *  - `--strict-mcp-config` with an empty server map plus an isolated
 *    `CLAUDE_CONFIG_DIR` is what keeps the tool surface at 27 instead of 71.
 *  - stdin is /dev/null; otherwise the CLI waits 3s for piped input and warns.
 *
 * `[claude-code:unrecognized_model]` on stderr is expected gateway telemetry.
 *
 * The child runs with `--dangerously-skip-permissions`, so the benchmarked
 * model can `env` its own process and echo the IU bearer token into the stream
 * — which is tee'd to a committed transcript. `makeRedactor` scrubs the token
 * out of stdout and stderr before either reaches disk or the parser.
 *
 * The spawn is injectable (`Spawner`) so the whole harness — sandbox, grading,
 * scoring, report — is exercisable with `--dry-run` and no API spend.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";

/** Grace period between SIGTERM and SIGKILL when a run overruns its budget. */
const KILL_GRACE_MS = 15_000;

export interface IuCredentials {
  apiKey: string;
  /** Base URL WITHOUT a trailing `/v1` — the CLI appends its own paths. */
  baseUrl: string;
  source: "keychain" | "env" | "mixed";
}

/** `.env.tpl` carries the `/v1` suffix the REST probes need; the CLI does not. */
export function stripV1(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function keychainValue(service: string): string | null {
  const result = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value === "" ? null : value;
}

/**
 * Keychain first so the runner works headless with no 1Password prompt; the
 * `op run`-injected env vars are the fallback for a machine without the
 * `claude-sdk-*` keychain items.
 */
export function resolveCredentials(env: NodeJS.ProcessEnv = process.env): IuCredentials {
  const keychainKey = keychainValue("claude-sdk-api-key");
  const keychainBase = keychainValue("claude-sdk-base-url");
  const apiKey = keychainKey ?? env["IU_API_KEY"] ?? null;
  const rawBase = keychainBase ?? env["IU_ANTHROPIC_BASE_URL"] ?? null;
  if (!apiKey) {
    throw new Error(
      "no IU key — expected keychain item `claude-sdk-api-key` or IU_API_KEY in the environment",
    );
  }
  if (!rawBase) {
    throw new Error(
      "no IU base URL — expected keychain item `claude-sdk-base-url` or IU_ANTHROPIC_BASE_URL",
    );
  }
  const source: IuCredentials["source"] =
    keychainKey && keychainBase ? "keychain" : !keychainKey && !keychainBase ? "env" : "mixed";
  return { apiKey, baseUrl: stripV1(rawBase), source };
}

export interface SpawnArgsOptions {
  modelId: string;
  prompt: string;
  maxTurns: number;
}

/** The argv after `claude`. The prompt is the final positional argument. */
export function buildSpawnArgs(options: SpawnArgsOptions): string[] {
  return [
    "-p",
    "--model",
    options.modelId,
    "--dangerously-skip-permissions",
    "--max-turns",
    String(options.maxTurns),
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--output-format",
    "stream-json",
    "--verbose",
    options.prompt,
  ];
}

export interface SpawnEnvOptions {
  modelId: string;
  credentials: IuCredentials;
  configDir: string;
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * Builds the child env. `ANTHROPIC_API_KEY` is *deleted* rather than blanked —
 * an empty string is what makes the CLI report "Not logged in".
 */
export function buildSpawnEnv(options: SpawnEnvOptions): Record<string, string> {
  const base = options.baseEnv ?? process.env;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (key === "ANTHROPIC_API_KEY") continue;
    if (value !== undefined) env[key] = value;
  }
  env["ANTHROPIC_AUTH_TOKEN"] = options.credentials.apiKey;
  env["ANTHROPIC_BASE_URL"] = options.credentials.baseUrl;
  env["CLAUDE_CONFIG_DIR"] = options.configDir;
  // All four tiers, same id — see the module header.
  env["ANTHROPIC_DEFAULT_OPUS_MODEL"] = options.modelId;
  env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = options.modelId;
  env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = options.modelId;
  env["ANTHROPIC_DEFAULT_FABLE_MODEL"] = options.modelId;
  return env;
}

/** What a redacted credential is replaced with, in transcripts and in memory. */
export const REDACTION_PLACEHOLDER = "<REDACTED-IU-KEY>";

/** A streaming string filter. `push` returns the safe prefix of what it has
 *  seen so far; `flush` releases the held-back tail at end of stream. */
export interface Redactor {
  push(chunk: string): string;
  flush(): string;
}

/**
 * Replaces every occurrence of `secret` with `REDACTION_PLACEHOLDER` across a
 * chunked stream.
 *
 * A token can straddle two `data` events, so scrubbing each chunk in isolation
 * would leak it. The last `secret.length - 1` characters of every chunk are
 * held back until the next one arrives — short enough to be cheap, long enough
 * that no split of the token can escape. `secret` is matched literally via
 * `replaceAll(string, string)`; nothing is ever compiled into a regex.
 */
export function makeRedactor(secret: string): Redactor {
  if (secret === "") return { push: (chunk) => chunk, flush: () => "" };
  const holdBack = secret.length - 1;
  let pending = "";
  return {
    push(chunk: string): string {
      const buffer = (pending + chunk).replaceAll(secret, REDACTION_PLACEHOLDER);
      const cut = Math.max(0, buffer.length - holdBack);
      pending = buffer.slice(cut);
      return buffer.slice(0, cut);
    },
    flush(): string {
      const rest = pending.replaceAll(secret, REDACTION_PLACEHOLDER);
      pending = "";
      return rest;
    },
  };
}

export interface SpawnRunOptions {
  modelId: string;
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  cwd: string;
  configDir: string;
  /** Every byte of stdout is tee'd here as it arrives, so a killed run still
   *  leaves the partial transcript on disk. */
  transcriptPath: string;
  credentials: IuCredentials;
}

export interface SpawnRunOutcome {
  raw: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
  durationMs: number;
}

export type Spawner = (options: SpawnRunOptions) => Promise<SpawnRunOutcome>;

/** The real spawn. Kills with SIGTERM on timeout, SIGKILL 15s later. */
export const spawnClaude: Spawner = async (options) => {
  await fs.mkdir(path.dirname(options.transcriptPath), { recursive: true });
  const tee = createWriteStream(options.transcriptPath, { flags: "w" });
  const startedAt = Date.now();

  return new Promise<SpawnRunOutcome>((resolve) => {
    const child = spawn("claude", buildSpawnArgs(options), {
      cwd: options.cwd,
      env: buildSpawnEnv({
        modelId: options.modelId,
        credentials: options.credentials,
        configDir: options.configDir,
      }),
      // 'ignore' hands the child /dev/null on stdin, which is what stops the
      // CLI's 3s wait-for-piped-input warning.
      stdio: ["ignore", "pipe", "pipe"],
    });

    let raw = "";
    let stderr = "";
    let killed = false;
    let settled = false;
    let hardKill: NodeJS.Timeout | null = null;
    // One redactor per stream — each keeps its own straddle buffer.
    const stdoutRedactor = makeRedactor(options.credentials.apiKey);
    const stderrRedactor = makeRedactor(options.credentials.apiKey);

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      hardKill = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, options.timeoutMs);

    // `error` and `close` can both fire; the first one wins.
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      // Release whatever the straddle buffers are still holding, or the last
      // few bytes of the transcript go missing.
      const tail = stdoutRedactor.flush();
      raw += tail;
      if (tail !== "") tee.write(tail);
      stderr += stderrRedactor.flush();
      tee.end();
      resolve({ raw, stderr, exitCode, killed, durationMs: Date.now() - startedAt });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = stdoutRedactor.push(chunk.toString());
      raw += text;
      if (text !== "") tee.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += stderrRedactor.push(chunk.toString());
    });
    child.on("error", (err: Error) => {
      stderr += `\nspawn error: ${err.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
};

export interface StubSpawnerOptions {
  /** Synthetic wall clock, so --dry-run reports are stable. */
  durationMs?: number;
}

/**
 * The `--dry-run` spawner. Emits a transcript in the real stream-json shape —
 * including a shared `message.id` across two `tool_use` events, so the parallel
 * detection path is exercised too — without touching the API. This is how the
 * harness is validated for free; it is a first-class path, not a test hack.
 */
export function makeStubSpawner(stubOptions: StubSpawnerOptions = {}): Spawner {
  return async (options) => {
    const durationMs = stubOptions.durationMs ?? 1234;
    const messageId = `msg_stub_${Math.random().toString(36).slice(2, 10)}`;
    const events: unknown[] = [
      {
        type: "system",
        subtype: "init",
        model: options.modelId,
        tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
        slash_commands: [],
        mcp_servers: [],
        cwd: options.cwd,
        apiKeySource: "none",
      },
      {
        type: "assistant",
        message: {
          id: messageId,
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: { file_path: `${options.cwd}/README.md` },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
          stop_reason: null,
        },
      },
      {
        type: "assistant",
        message: {
          id: messageId,
          content: [
            { type: "tool_use", id: "toolu_2", name: "Glob", input: { pattern: "**/*.ts" } },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
          stop_reason: null,
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: null, content: "ok" }],
        },
      },
      {
        type: "assistant",
        message: {
          id: `${messageId}_2`,
          content: [{ type: "text", text: "[dry-run] no model was called." }],
          usage: { input_tokens: 120, output_tokens: 30 },
          stop_reason: "end_turn",
        },
      },
      {
        type: "result",
        subtype: "success",
        num_turns: 2,
        duration_ms: durationMs,
        duration_api_ms: Math.round(durationMs * 0.6),
        ttft_ms: 400,
        total_cost_usd: 0,
        is_error: false,
        api_error_status: null,
        terminal_reason: "completed",
        result: "[dry-run] no model was called.",
        permission_denials: [],
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens_details: { thinking_tokens: 0 },
          service_tier: "standard",
        },
        modelUsage: {
          [options.modelId]: {
            inputTokens: 120,
            outputTokens: 30,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0,
            contextWindow: 200_000,
            maxOutputTokens: 32_000,
            provider: "iu",
            costBasis: "list",
          },
        },
      },
    ];
    const raw = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
    await fs.mkdir(path.dirname(options.transcriptPath), { recursive: true });
    await fs.writeFile(options.transcriptPath, raw, "utf8");
    return { raw, stderr: "", exitCode: 0, killed: false, durationMs };
  };
}
