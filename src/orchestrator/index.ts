import { markCompleted } from "../webhook/server.js";
import type { Job } from "./queue.js";
import type { ResolvedProjectConfig } from "../resolve-config.js";
import { log, startPipelineLog, endPipelineLog, postLinearComment, updateLinearStatus } from "./logger.js";
import { runClaude } from "./claude.js";
import { runImplementPhase } from "./phases/implement.js";
import { runReviewPhase } from "./phases/review.js";
import { runTestPhase } from "./phases/test.js";
import { runFinalizePhase } from "./phases/finalize.js";
import type { PhaseName } from "../schema.js";

export interface PipelineContext {
  issueId: string;
  issueTitle: string;
  issueDescription: string;
  branchName: string;
  project: ResolvedProjectConfig;
  reviewIterations: number;
  testAttempts: number;
  phaseResets: number;
  implementOutput?: string;
  reviewSummary?: string;
  testVerdict?: string;
  prUrl?: string;
}

const PHASE_RUNNERS: Record<PhaseName, (ctx: PipelineContext) => Promise<boolean>> = {
  implement: runImplementPhase,
  review: runReviewPhase,
  test: runTestPhase,
  finalize: runFinalizePhase,
};

async function fetchBranchName(ctx: PipelineContext): Promise<string | null> {
  const { issueId, project } = ctx;
  const result = await runClaude({
    prompt: `Fetch Linear issue ${issueId} using mcp__plugin_linear_linear__get_issue with includeRelations: false. Output ONLY the branchName field value on a single line, nothing else.`,
    model: "haiku",
    cwd: project.repoPath,
    maxBudgetUsd: project.budgets.intake,
    timeoutMs: project.timeouts.intake,
  });

  if (result.exitCode !== 0) return null;
  const branch = result.stdout.trim().split("\n").pop()?.trim();
  return branch || null;
}

export async function runPipeline(job: Job): Promise<void> {
  const logFile = startPipelineLog(job.issueId);
  log("info", `Pipeline started (log: ${logFile})`, job.issueId);

  const ctx: PipelineContext = {
    issueId: job.issueId,
    issueTitle: job.issueTitle,
    issueDescription: job.issueDescription,
    branchName: job.branchName,
    project: job.project,
    reviewIterations: 0,
    testAttempts: 0,
    phaseResets: 0,
  };

  const cwd = ctx.project.repoPath;

  try {
    // Phase 0: Issue intake — fetch branch name if missing, update Linear status
    if (!ctx.branchName) {
      log("info", "Branch name missing from webhook, fetching from Linear", ctx.issueId);
      const branch = await fetchBranchName(ctx);
      if (branch) {
        ctx.branchName = branch;
      } else {
        log("error", "Could not fetch branch name from Linear", ctx.issueId);
        await postLinearComment(ctx.issueId, "Pipeline failed: could not determine branch name for this issue.", cwd);
        return;
      }
    }

    await updateLinearStatus(ctx.issueId, "In Progress", cwd);
    await postLinearComment(ctx.issueId, "Pipeline started — implementing automatically.", cwd);

    // Run configured phases
    for (const phase of ctx.project.phases) {
      log("info", `=== Phase: ${phase} ===`, ctx.issueId);

      const runner = PHASE_RUNNERS[phase];
      const success = await runner(ctx);

      if (!success) {
        if (phase === "implement") {
          const reason = ctx.implementOutput?.startsWith("UNCLEAR")
            ? ctx.implementOutput
            : "Implementation failed";
          await postLinearComment(ctx.issueId, `Pipeline stopped: ${reason}`, cwd);
          await updateLinearStatus(ctx.issueId, "Todo", cwd);
          return;
        }

        if (phase === "finalize") {
          await postLinearComment(ctx.issueId, "Pipeline completed but PR creation failed. Check logs.", cwd);
          await updateLinearStatus(ctx.issueId, "In Review", cwd);
          return;
        }

        // review/test not fully clean — log warning but continue
        log("warn", `Phase ${phase} not fully clean, proceeding`, ctx.issueId);
      }

      // Finalize success — post summary
      if (phase === "finalize" && success) {
        const summary = [
          `Automated PR created: ${ctx.prUrl}`,
          "",
          "**Quality Gate Results:**",
          `- Code Review: ${ctx.reviewSummary ?? "Not run"}`,
          `- Visual Test: ${ctx.testVerdict ?? "Not run"}`,
          `- Review Iterations: ${ctx.reviewIterations}`,
          `- Test Attempts: ${ctx.testAttempts}`,
        ].join("\n");

        await postLinearComment(ctx.issueId, summary, cwd);
        await updateLinearStatus(ctx.issueId, "In Review", cwd);
        log("info", "Pipeline completed successfully", ctx.issueId);
      }
    }
  } catch (err) {
    log("error", `Pipeline error: ${err}`, ctx.issueId);
    await postLinearComment(ctx.issueId, `Pipeline crashed: ${err}`, cwd).catch(() => {});
    await updateLinearStatus(ctx.issueId, "Todo", cwd).catch(() => {});
  } finally {
    markCompleted(ctx.issueId);
    endPipelineLog();
  }
}
