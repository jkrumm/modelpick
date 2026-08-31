/**
 * Parses a `claude -p --output-format stream-json` transcript into RunMetrics.
 *
 * Built against a real transcript, not the docs. Two shapes here are easy to
 * get wrong and both silently corrupt the benchmark:
 *
 *  1. The CLI emits ONE content block per `assistant` event. Counting
 *     `tool_use` blocks per event therefore always yields 1 and reports zero
 *     parallelism for every model. Parallel batches are detected by grouping
 *     consecutive assistant events on `message.id` — one id carrying N
 *     `tool_use` blocks is one batch of width N.
 *  2. `message.usage` is repeated *identically* on every event of the same
 *     message. Summing it multiplies the bill. Authoritative totals come from
 *     the final `result` event.
 *
 * The parser is defensive by contract: a run can die mid-stream with no
 * `result` event at all (timeout, CLI crash, gateway 400 on turn 1). It
 * reconstructs what it can, records why in `notes`, and never throws.
 */
import type { BenchFailure, RunMetrics } from "./types.js";

export interface ParseTranscriptInput {
  /** Raw newline-delimited stream-json as written by the CLI. */
  raw: string;
  /** Wall clock measured by the runner, spawn to exit. */
  durationMs: number;
  /** True when the runner killed the child for exceeding `task.timeoutMs`. */
  killed?: boolean;
  exitCode?: number | null;
  stderr?: string;
  /** Absolute sandbox path, used to make edited file paths relative. */
  sandboxDir?: string;
}

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** `[claude-code:unrecognized_model]` is expected telemetry from the gateway,
 *  not an error — it must never end up in the failure notes. */
const BENIGN_STDERR = /unrecognized_model|^\s*$/;

const API_ERROR_IN_STDERR = /API Error:?\s*(\d{3})/i;

/** A 4xx that names the model, its tools, or thinking means the model is
 *  served but cannot drive the loop — that is `incompatible`, not `api_error`. */
const INCOMPATIBLE_HINT = /\b(model|tool|tools|thinking|schema)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** macOS resolves /tmp to /private/tmp, so the CLI reports a path the runner
 *  never wrote. Normalise both sides before comparing. */
function unprivate(p: string): string {
  return p.startsWith("/private/") ? p.slice("/private".length) : p;
}

function relativeTo(sandboxDir: string | undefined, filePath: string): string {
  if (!sandboxDir) return filePath;
  const base = unprivate(sandboxDir).replace(/\/$/, "");
  const target = unprivate(filePath);
  if (target === base) return ".";
  if (target.startsWith(`${base}/`)) return target.slice(base.length + 1);
  return filePath;
}

interface StreamScan {
  malformedLines: number;
  events: Record<string, unknown>[];
  resultEvent: Record<string, unknown> | null;
}

function scanLines(raw: string): StreamScan {
  const scan: StreamScan = { malformedLines: 0, events: [], resultEvent: null };
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      scan.malformedLines += 1;
      continue;
    }
    if (!isRecord(parsed)) {
      scan.malformedLines += 1;
      continue;
    }
    scan.events.push(parsed);
    if (str(parsed["type"]) === "result") scan.resultEvent = parsed;
  }
  return scan;
}

interface ToolScan {
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  filesEdited: string[];
  parallelBatches: number;
  maxParallelWidth: number;
  assistantMessageIds: number;
}

/** Groups tool_use blocks by `message.id` — the only way parallelism is
 *  observable in this stream (see the header note). */
function scanAssistantEvents(
  events: Record<string, unknown>[],
  sandboxDir: string | undefined,
): ToolScan {
  const perMessage = new Map<string, number>();
  const byName: Record<string, number> = {};
  const files: string[] = [];
  const seenFiles = new Set<string>();
  let toolCalls = 0;

  events.forEach((event, index) => {
    if (str(event["type"]) !== "assistant") return;
    const message = isRecord(event["message"]) ? event["message"] : null;
    if (!message) return;
    // An event without an id cannot be grouped, so give it a key of its own
    // rather than merging every anonymous event into one fake batch.
    const messageId = str(message["id"]) ?? `anonymous-${index}`;
    if (!perMessage.has(messageId)) perMessage.set(messageId, 0);

    for (const rawBlock of arr(message["content"])) {
      if (!isRecord(rawBlock)) continue;
      if (str(rawBlock["type"]) !== "tool_use") continue;
      toolCalls += 1;
      perMessage.set(messageId, (perMessage.get(messageId) ?? 0) + 1);
      const name = str(rawBlock["name"]) ?? "unknown";
      byName[name] = (byName[name] ?? 0) + 1;
      if (!EDIT_TOOLS.has(name)) continue;
      const input = isRecord(rawBlock["input"]) ? rawBlock["input"] : null;
      const filePath = input ? (str(input["file_path"]) ?? str(input["notebook_path"])) : null;
      if (!filePath) continue;
      const rel = relativeTo(sandboxDir, filePath);
      if (seenFiles.has(rel)) continue;
      seenFiles.add(rel);
      files.push(rel);
    }
  });

  const widths = [...perMessage.values()];
  const parallelBatches = widths.filter((w) => w >= 2).length;
  const maxParallelWidth = toolCalls === 0 ? 0 : Math.max(1, ...widths);

  return {
    toolCalls,
    toolCallsByName: byName,
    filesEdited: files,
    parallelBatches,
    maxParallelWidth,
    assistantMessageIds: perMessage.size,
  };
}

/** `tool_result` blocks the harness flagged — the single best tool-fidelity
 *  signal we get for free. */
function countToolErrors(events: Record<string, unknown>[]): number {
  let errors = 0;
  for (const event of events) {
    if (str(event["type"]) !== "user") continue;
    const message = isRecord(event["message"]) ? event["message"] : null;
    if (!message) continue;
    for (const block of arr(message["content"])) {
      if (!isRecord(block)) continue;
      if (str(block["type"]) !== "tool_result") continue;
      if (block["is_error"] === true) errors += 1;
    }
  }
  return errors;
}

/** Turn caps arrive as a subtype, not as an error status — so `error_max_turns`
 *  must not inflate the API-error count. */
function isErrorSubtype(subtype: string | null): boolean {
  return subtype !== null && subtype.startsWith("error") && subtype !== "error_max_turns";
}

function countApiErrors(
  events: Record<string, unknown>[],
  resultEvent: Record<string, unknown> | null,
  stderrStatus: number | null,
): number {
  let errors = 0;
  for (const event of events) {
    if (event === resultEvent) continue;
    if (event["error"] !== undefined && event["error"] !== null) errors += 1;
    else if (isErrorSubtype(str(event["subtype"]))) errors += 1;
  }
  if (resultEvent) {
    if (num(resultEvent["api_error_status"]) !== null) errors += 1;
    else if (isErrorSubtype(str(resultEvent["subtype"]))) errors += 1;
  } else if (stderrStatus !== null) {
    errors += 1;
  }
  return errors;
}

function collectErrorText(
  events: Record<string, unknown>[],
  resultEvent: Record<string, unknown> | null,
  stderr: string,
): string {
  const parts: string[] = [stderr];
  for (const event of events) {
    const err = event["error"];
    if (typeof err === "string") parts.push(err);
    else if (isRecord(err)) parts.push(JSON.stringify(err));
  }
  if (resultEvent) parts.push(str(resultEvent["result"]) ?? "");
  return parts.join("\n");
}

function usageFromResult(resultEvent: Record<string, unknown> | null): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
} {
  const usage = resultEvent && isRecord(resultEvent["usage"]) ? resultEvent["usage"] : null;
  const details =
    usage && isRecord(usage["output_tokens_details"]) ? usage["output_tokens_details"] : null;
  return {
    inputTokens: usage ? (num(usage["input_tokens"]) ?? 0) : 0,
    outputTokens: usage ? (num(usage["output_tokens"]) ?? 0) : 0,
    cacheReadTokens: usage ? (num(usage["cache_read_input_tokens"]) ?? 0) : 0,
    cacheCreationTokens: usage ? (num(usage["cache_creation_input_tokens"]) ?? 0) : 0,
    thinkingTokens: details ? (num(details["thinking_tokens"]) ?? 0) : 0,
  };
}

/** `total_cost_usd` and `modelUsage[*].costUSD` come back with
 *  `costBasis: "list"` — Anthropic list pricing, NOT what IU bills. Recorded
 *  as-is; every renderer labels it list-basis. */
function costFromResult(resultEvent: Record<string, unknown> | null): number | null {
  if (!resultEvent) return null;
  const total = num(resultEvent["total_cost_usd"]);
  if (total !== null) return total;
  const modelUsage = isRecord(resultEvent["modelUsage"]) ? resultEvent["modelUsage"] : null;
  if (!modelUsage) return null;
  let sum = 0;
  let found = false;
  for (const entry of Object.values(modelUsage)) {
    if (!isRecord(entry)) continue;
    const cost = num(entry["costUSD"]);
    if (cost === null) continue;
    sum += cost;
    found = true;
  }
  return found ? sum : null;
}

function stderrNotes(stderr: string): string[] {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !BENIGN_STDERR.test(line))
    .slice(0, 3)
    .map((line) => `stderr: ${line.slice(0, 200)}`);
}

export function parseTranscript(input: ParseTranscriptInput): RunMetrics {
  const stderr = input.stderr ?? "";
  const killed = input.killed ?? false;
  const scan = scanLines(input.raw);
  const tools = scanAssistantEvents(scan.events, input.sandboxDir);
  const toolErrors = countToolErrors(scan.events);
  const result = scan.resultEvent;

  const stderrMatch = API_ERROR_IN_STDERR.exec(stderr);
  const stderrStatus = stderrMatch?.[1] !== undefined ? Number(stderrMatch[1]) : null;
  const apiErrorStatus = result ? num(result["api_error_status"]) : stderrStatus;
  const apiErrors = countApiErrors(scan.events, result, stderrStatus);

  const notes: string[] = [];
  if (scan.malformedLines > 0) {
    notes.push(`${scan.malformedLines} malformed transcript line(s) skipped`);
  }
  if (!result) {
    notes.push(
      "stream ended without a result event — metrics reconstructed from a partial transcript",
    );
  }
  notes.push(...stderrNotes(stderr));

  const subtype = result ? str(result["subtype"]) : null;
  const terminalReason = result ? str(result["terminal_reason"]) : null;
  const isError = result ? result["is_error"] === true : false;
  const errorText = collectErrorText(scan.events, result, stderr);

  const failure = classifyFailure({
    killed,
    hasResult: result !== null,
    subtype,
    terminalReason,
    isError,
    apiErrorStatus,
    apiErrors,
    assistantMessages: tools.assistantMessageIds,
    errorText,
    exitCode: input.exitCode ?? null,
  });

  const usage = usageFromResult(result);

  return {
    ok: failure === "none",
    failure,
    durationMs: input.durationMs,
    apiDurationMs: result ? num(result["duration_api_ms"]) : null,
    ttftMs: result ? num(result["ttft_ms"]) : null,
    numTurns: result
      ? (num(result["num_turns"]) ?? tools.assistantMessageIds)
      : tools.assistantMessageIds,
    ...usage,
    costUsd: costFromResult(result),
    toolCalls: tools.toolCalls,
    toolCallsByName: tools.toolCallsByName,
    toolErrors,
    parallelBatches: tools.parallelBatches,
    maxParallelWidth: tools.maxParallelWidth,
    apiErrors,
    terminalReason,
    filesEdited: tools.filesEdited,
    notes,
  };
}

interface FailureInput {
  killed: boolean;
  hasResult: boolean;
  subtype: string | null;
  terminalReason: string | null;
  isError: boolean;
  apiErrorStatus: number | null;
  apiErrors: number;
  assistantMessages: number;
  errorText: string;
  exitCode: number | null;
}

/**
 * Maps a finished run onto `BENCH_FAILURE`. Order matters: a timeout that also
 * produced a 4xx is still a timeout, and a first-turn 4xx that names the model
 * is `incompatible` (the model is served but cannot drive the loop) rather than
 * a transient `api_error`.
 */
export function classifyFailure(input: FailureInput): BenchFailure {
  if (input.killed) return "timeout";

  const hitTurnCap =
    input.subtype === "error_max_turns" ||
    (input.terminalReason !== null && /max[_ ]?turns/i.test(input.terminalReason));
  const fourXx =
    input.apiErrorStatus !== null && input.apiErrorStatus >= 400 && input.apiErrorStatus < 500;

  if (fourXx && input.assistantMessages === 0 && INCOMPATIBLE_HINT.test(input.errorText)) {
    return "incompatible";
  }
  if (hitTurnCap) return "max_turns";
  if (input.apiErrorStatus !== null || input.apiErrors > 0) return "api_error";
  if (!input.hasResult) {
    // No result event, no error evidence: the CLI or the harness around it died.
    // Not the model's fault, so it must not be scored as one.
    return "harness_error";
  }
  if (input.isError) return "api_error";
  return "none";
}

/** The agent's last word, taken from the `result` event when there is one and
 *  falling back to the last assistant text block on a truncated stream. */
export function extractFinalText(raw: string): string {
  const scan = scanLines(raw);
  const fromResult = scan.resultEvent ? str(scan.resultEvent["result"]) : null;
  if (fromResult !== null) return fromResult;
  let last = "";
  for (const event of scan.events) {
    if (str(event["type"]) !== "assistant") continue;
    const message = isRecord(event["message"]) ? event["message"] : null;
    if (!message) continue;
    for (const block of arr(message["content"])) {
      if (!isRecord(block)) continue;
      if (str(block["type"]) !== "text") continue;
      const text = str(block["text"]);
      if (text !== null && text.trim() !== "") last = text;
    }
  }
  return last;
}

/**
 * Metrics for a run that never reached the model - fixture copy failed, sandbox
 * unwritable, grader crashed. Recorded as `harness_error` so it is visibly ours
 * and never counted against the model.
 */
export function harnessErrorMetrics(message: string, durationMs: number): RunMetrics {
  return {
    ok: false,
    failure: "harness_error",
    durationMs,
    apiDurationMs: null,
    ttftMs: null,
    numTurns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    thinkingTokens: 0,
    costUsd: null,
    toolCalls: 0,
    toolCallsByName: {},
    toolErrors: 0,
    parallelBatches: 0,
    maxParallelWidth: 0,
    apiErrors: 0,
    terminalReason: null,
    filesEdited: [],
    notes: [`harness error: ${message}`],
  };
}
