import { spawn } from "node:child_process";

export interface ClaudeOptions {
  prompt: string;
  model?: "opus" | "sonnet" | "haiku";
  cwd: string;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  allowedTools?: string[];
}

export interface ClaudeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runClaude(options: ClaudeOptions): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    const args: string[] = [
      "-p",
      options.prompt,
      "--no-session-persistence",
      "--permission-mode",
      "bypassPermissions",
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.maxBudgetUsd !== undefined) {
      args.push("--max-budget-usd", String(options.maxBudgetUsd));
    }

    if (options.allowedTools?.length) {
      args.push("--allowed-tools", ...options.allowedTools);
    }

    const child = spawn("claude", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let timer: ReturnType<typeof setTimeout> | undefined;

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        child.kill("SIGTERM");
        // Force kill after 5s grace period
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5_000);
      }, options.timeoutMs);
    }

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr + `\nSpawn error: ${err.message}`,
        timedOut: false,
      });
    });
  });
}
