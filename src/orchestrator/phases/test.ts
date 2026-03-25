import { runClaude } from "../claude.js";
import { log } from "../logger.js";
import type { PipelineContext } from "../index.js";
import { runReviewPhase } from "./review.js";

function parseVerdict(output: string, pattern: RegExp): "PASS" | "FAIL" | "NEEDS_ATTENTION" | null {
  const match = output.match(pattern);
  return match ? (match[1].toUpperCase() as "PASS" | "FAIL" | "NEEDS_ATTENTION") : null;
}

export async function runTestPhase(ctx: PipelineContext): Promise<boolean> {
  const { issueId, project } = ctx;

  // Skip if no test skill configured
  if (!project.skills.test) {
    log("info", "Test phase skipped (no test skill configured)", issueId);
    ctx.testVerdict = "Skipped";
    return true;
  }

  for (let attempt = 1; attempt <= project.maxTestAttempts; attempt++) {
    ctx.testAttempts = attempt;
    log("info", `Test attempt ${attempt}/${project.maxTestAttempts}`, issueId);

    const result = await runClaude({
      prompt: project.skills.test,
      model: project.model,
      cwd: project.repoPath,
      maxBudgetUsd: project.budgets.test,
      timeoutMs: project.timeouts.test,
    });

    if (result.timedOut) {
      log("warn", "Test timed out", issueId);
      ctx.testVerdict = "TIMEOUT";
      continue;
    }

    const verdict = parseVerdict(result.stdout, project.patterns.testVerdict);
    ctx.testVerdict = verdict ?? "UNKNOWN";

    if (verdict === "PASS") {
      log("info", "Test passed", issueId);
      return true;
    }

    log("warn", `Test: ${verdict ?? "no verdict"}`, issueId);

    // Last attempt — don't fix, just report
    if (attempt === project.maxTestAttempts) {
      log("warn", "Max test attempts reached", issueId);
      return false;
    }

    // Fix the issues identified by the test
    ctx.phaseResets++;
    if (ctx.phaseResets > project.maxPhaseResets) {
      log("warn", "Max phase resets reached, skipping further test fixes", issueId);
      return false;
    }

    log("info", "Fixing test issues", issueId);
    const fixResult = await runClaude({
      prompt: `The test found these issues:\n\n${result.stdout}\n\nFix only the issues identified above. Do not make any other changes.\nCommit with message: "${issueId}: fix test issues"`,
      model: project.model,
      cwd: project.repoPath,
      maxBudgetUsd: project.budgets.fix,
      timeoutMs: project.timeouts.fix,
    });

    if (fixResult.timedOut) {
      log("warn", "Test fix timed out", issueId);
    }

    // Re-run review to make sure fixes are clean
    log("info", "Re-running review after test fix", issueId);
    await runReviewPhase(ctx);
  }

  return false;
}
