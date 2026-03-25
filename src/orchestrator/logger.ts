import { mkdirSync, appendFileSync } from "node:fs";
import { getConfig } from "../config.js";
import { runClaude } from "./claude.js";

type LogLevel = "info" | "warn" | "error";

let currentLogFile: string | null = null;

function ensureLogDir() {
  mkdirSync(getConfig().logDir, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString();
}

export function log(level: LogLevel, message: string, issueId?: string) {
  const prefix = issueId ? `[${issueId}]` : "[system]";
  const line = `${timestamp()} ${level.toUpperCase().padEnd(5)} ${prefix} ${message}`;

  console.log(line);

  if (currentLogFile) {
    appendFileSync(currentLogFile, line + "\n");
  }
}

export function startPipelineLog(issueId: string): string {
  ensureLogDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  currentLogFile = `${getConfig().logDir}/pipeline-${issueId}-${ts}.log`;
  log("info", "Pipeline log started", issueId);
  return currentLogFile;
}

export function endPipelineLog() {
  currentLogFile = null;
}

export async function postLinearComment(
  issueId: string,
  comment: string,
  cwd: string
): Promise<void> {
  const prompt = `Post a comment on Linear issue ${issueId} using mcp__plugin_linear_linear__create_comment. The comment body is:\n\n${comment}\n\nDo not output anything else.`;

  const result = await runClaude({
    prompt,
    model: "haiku",
    cwd,
    maxBudgetUsd: 0.5,
    timeoutMs: 3 * 60_000,
  });

  if (result.exitCode !== 0) {
    log("warn", `Failed to post Linear comment: ${result.stderr}`, issueId);
  }
}

export async function updateLinearStatus(
  issueId: string,
  status: string,
  cwd: string
): Promise<void> {
  const prompt = `Update Linear issue ${issueId} status to "${status}" using mcp__plugin_linear_linear__update_issue. If "${status}" doesn't exist, try case-insensitive matching against available statuses. Do not output anything else.`;

  const result = await runClaude({
    prompt,
    model: "haiku",
    cwd,
    maxBudgetUsd: 0.5,
    timeoutMs: 3 * 60_000,
  });

  if (result.exitCode !== 0) {
    log("warn", `Failed to update Linear status: ${result.stderr}`, issueId);
  }
}
