import { defineConfig } from "./src/schema.js";

export default defineConfig({
  // Global settings (can also be set via env vars)
  // port: 4177,              // or TAKY_CI_PORT
  // logDir: "~/.claude/ci-logs", // or TAKY_CI_LOG_DIR
  // maxConcurrent: 1,        // or TAKY_CI_MAX_CONCURRENT
  // linearWebhookSecret: "", // or LINEAR_WEBHOOK_SECRET
  // claudeBotUserId: "",     // or CLAUDE_BOT_USER_ID

  projects: [
    {
      // Required: path to the repo and Linear team key(s) for routing
      repoPath: "/home/user/projects/my-app",
      teamKeys: ["APP"],

      // Optional: branch to base work off (default: "main")
      baseBranch: "main",

      // Optional: model for implementation (default: "sonnet")
      model: "sonnet",

      // Optional: custom prompt prefix for the implement phase
      implementPrompt: "You are implementing a feature for the My App project.",

      // Optional: phases to run (default: all four)
      // phases: ["implement", "review", "test", "finalize"],

      // Optional: skill commands (set to null to skip that phase)
      // Supports placeholders: ${issueId}, ${description}, ${reportPath}
      skills: {
        review: "/my-app:review-code --all",
        fix: "/my-app:fix-code ${reportPath} --no-consider",
        test: "/my-app:try",
        commit: '/my-app:commit ${issueId}: ${description}',
      },

      // Optional: custom output parsing patterns
      // patterns: {
      //   reviewClean: [/all checks passed/i, /0 errors/i],
      //   reviewReportPath: /Report saved to:\s*(.+)/,
      //   reviewSummary: /Summary:\s*(\d+)\s*must fix,\s*(\d+)\s*should fix,\s*(\d+)\s*to consider/i,
      //   testVerdict: /VERDICT:\s*(PASS|FAIL|NEEDS_ATTENTION)/i,
      // },

      // Optional: override budgets (USD) and timeouts (ms) per phase
      // budgets: { implement: 8, review: 5 },
      // timeouts: { implement: 30 * 60_000 },

      // Optional: override iteration limits
      // maxReviewIterations: 3,
      // maxTestAttempts: 2,
      // maxPhaseResets: 2,
    },

    // Add more projects:
    // {
    //   repoPath: "/home/user/projects/other-project",
    //   teamKeys: ["OTH"],
    //   baseBranch: "develop",
    //   phases: ["implement", "review", "finalize"], // skip test
    //   skills: {
    //     review: "Run pnpm lint && pnpm typecheck. Report errors.",
    //     fix: "Fix the issues in this report: ${reportPath}",
    //     commit: null, // let Claude decide how to commit
    //   },
    // },
  ],
});
