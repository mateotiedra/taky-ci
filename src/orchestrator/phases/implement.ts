import { execSync } from "node:child_process";
import { runClaude } from "../claude.js";
import { log } from "../logger.js";
import { interpolate } from "../../utils.js";
import type { PipelineContext } from "../index.js";

export async function runImplementPhase(ctx: PipelineContext): Promise<boolean> {
  const { issueId, issueTitle, issueDescription, branchName, project } = ctx;
  const { repoPath, baseBranch } = project;

  // Deterministic git setup
  log("info", `Setting up branch ${branchName} from ${baseBranch}`, issueId);
  try {
    execSync(`git checkout ${baseBranch} && git pull origin ${baseBranch}`, {
      cwd: repoPath,
      stdio: "pipe",
    });

    // Check if branch already exists
    try {
      execSync(`git rev-parse --verify ${branchName}`, {
        cwd: repoPath,
        stdio: "pipe",
      });
      // Branch exists — delete and recreate for a clean start
      log("info", `Branch ${branchName} exists, recreating`, issueId);
      execSync(`git branch -D ${branchName}`, {
        cwd: repoPath,
        stdio: "pipe",
      });
    } catch {
      // Branch doesn't exist — good
    }

    execSync(`git checkout -b ${branchName}`, {
      cwd: repoPath,
      stdio: "pipe",
    });
  } catch (err) {
    log("error", `Git setup failed: ${err}`, issueId);
    return false;
  }

  // Build commit instruction
  let commitInstruction: string;
  if (project.skills.commit) {
    const commitCmd = interpolate(project.skills.commit, {
      issueId,
      description: "<brief description>",
    });
    commitInstruction = `Commit all changes using: ${commitCmd}`;
  } else {
    commitInstruction = `Commit all changes with message: "${issueId}: <brief description>"`;
  }

  // Claude implementation
  const prompt = `${project.implementPrompt}

Issue: ${issueId} - ${issueTitle}
Description:
${issueDescription}

Instructions:
1. You are already on branch "${branchName}" based on "${baseBranch}"
2. Analyze the issue requirements
3. Explore the codebase to understand existing patterns
4. Implement the changes following all project conventions (see CLAUDE.md)
5. ${commitInstruction}
6. Output "PHASE_COMPLETE" on a new line when done
7. If the issue is too vague to implement, output "PHASE_UNCLEAR: <explanation>"`;

  log("info", "Starting implementation", issueId);
  const result = await runClaude({
    prompt,
    model: project.model,
    cwd: repoPath,
    maxBudgetUsd: project.budgets.implement,
    timeoutMs: project.timeouts.implement,
  });

  if (result.timedOut) {
    log("error", "Implementation timed out", issueId);
    return false;
  }

  if (result.stdout.includes("PHASE_UNCLEAR")) {
    const explanation = result.stdout
      .split("PHASE_UNCLEAR:")[1]
      ?.trim()
      .split("\n")[0];
    log("warn", `Issue too vague: ${explanation}`, issueId);
    ctx.implementOutput = `UNCLEAR: ${explanation}`;
    return false;
  }

  if (result.stdout.includes("PHASE_COMPLETE")) {
    log("info", "Implementation complete", issueId);
    ctx.implementOutput = result.stdout;
    return true;
  }

  // No explicit signal — check if commits were made
  try {
    const diff = execSync(`git log ${baseBranch}..HEAD --oneline`, {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
    if (diff) {
      log("info", "Implementation produced commits (no explicit signal)", issueId);
      ctx.implementOutput = result.stdout;
      return true;
    }
  } catch {
    // ignore
  }

  log("error", `Implementation failed (exit ${result.exitCode})`, issueId);
  ctx.implementOutput = result.stdout;
  return false;
}
