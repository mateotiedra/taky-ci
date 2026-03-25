import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaude } from "../claude.js";
import { log } from "../logger.js";
import { interpolate } from "../../utils.js";
import type { PipelineContext } from "../index.js";

function isClean(output: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(output));
}

function extractReportPath(output: string, pattern: RegExp): string | null {
  const match = output.match(pattern);
  if (!match) return null;
  return match[1].trim().replace(/^~/, process.env.HOME ?? "~");
}

export async function runReviewPhase(ctx: PipelineContext): Promise<boolean> {
  const { issueId, project } = ctx;

  // Skip if no review skill configured
  if (!project.skills.review) {
    log("info", "Review phase skipped (no review skill configured)", issueId);
    ctx.reviewSummary = "Skipped";
    return true;
  }

  for (let i = 1; i <= project.maxReviewIterations; i++) {
    ctx.reviewIterations = i;
    log("info", `Review iteration ${i}/${project.maxReviewIterations}`, issueId);

    // Step 1: Run review
    const reviewResult = await runClaude({
      prompt: project.skills.review,
      model: project.model,
      cwd: project.repoPath,
      maxBudgetUsd: project.budgets.review,
      timeoutMs: project.timeouts.review,
    });

    if (reviewResult.timedOut) {
      log("warn", "Review timed out", issueId);
      ctx.reviewSummary = "Review timed out";
      return false;
    }

    const output = reviewResult.stdout;

    // Check if clean
    if (isClean(output, project.patterns.reviewClean)) {
      log("info", "Review passed — no violations", issueId);
      ctx.reviewSummary = "All checks passed";
      return true;
    }

    // Extract summary line for context
    const summaryMatch = output.match(project.patterns.reviewSummary);
    if (summaryMatch) {
      ctx.reviewSummary = `${summaryMatch[1]} must fix, ${summaryMatch[2]} should fix, ${summaryMatch[3]} to consider`;
    }

    // Last iteration — don't fix, just report
    if (i === project.maxReviewIterations) {
      log("warn", `Max review iterations reached: ${ctx.reviewSummary}`, issueId);
      return false;
    }

    // Skip fix if no fix skill configured
    if (!project.skills.fix) {
      log("warn", "Fix skill not configured, cannot auto-fix", issueId);
      return false;
    }

    // Save report and fix
    let reportPath = extractReportPath(output, project.patterns.reviewReportPath);
    if (!reportPath) {
      // Save output as temp report
      reportPath = join(
        tmpdir(),
        `taky-ci-review-${issueId}-${i}.md`
      );
      writeFileSync(reportPath, output);
    }

    log("info", `Fixing violations from: ${reportPath}`, issueId);
    const fixPrompt = interpolate(project.skills.fix, { reportPath });
    const fixResult = await runClaude({
      prompt: fixPrompt,
      model: project.model,
      cwd: project.repoPath,
      maxBudgetUsd: project.budgets.fix,
      timeoutMs: project.timeouts.fix,
    });

    if (fixResult.timedOut) {
      log("warn", "Fix timed out", issueId);
    }
  }

  return false;
}
