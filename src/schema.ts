export interface SkillsConfig {
  /** Slash command or prompt to run code review. Set to null to skip review phase. */
  review?: string | null;
  /** Slash command or prompt to fix code review violations. Supports ${reportPath} placeholder. */
  fix?: string | null;
  /** Slash command or prompt to run tests. Set to null to skip test phase. */
  test?: string | null;
  /** Slash command or prompt to commit. Supports ${issueId} and ${description} placeholders. */
  commit?: string | null;
}

export interface OutputPatterns {
  /** Regexes that indicate a clean review (no violations). */
  reviewClean?: RegExp[];
  /** Regex to extract a report file path from review output. */
  reviewReportPath?: RegExp;
  /** Regex to extract review summary (must fix / should fix / consider counts). */
  reviewSummary?: RegExp;
  /** Regex to extract test verdict (PASS/FAIL/NEEDS_ATTENTION). */
  testVerdict?: RegExp;
}

export type PhaseName = "implement" | "review" | "test" | "finalize";

export interface ProjectConfig {
  /** Absolute path to the repo working directory */
  repoPath: string;
  /** Linear team keys that route to this project */
  teamKeys: string[];
  /** Base branch to branch from (default: "main") */
  baseBranch?: string;
  /** Model to use for implementation (default: "sonnet") */
  model?: "opus" | "sonnet" | "haiku";
  /** Custom system prompt prefix for implementation */
  implementPrompt?: string;
  /** Skill commands */
  skills?: SkillsConfig;
  /** Output parsing patterns (sensible defaults provided) */
  patterns?: OutputPatterns;
  /** Phase budgets (USD) — override global defaults */
  budgets?: Partial<Record<"intake" | "implement" | "review" | "fix" | "test" | "finalize", number>>;
  /** Phase timeouts (ms) — override global defaults */
  timeouts?: Partial<Record<"intake" | "implement" | "review" | "fix" | "test" | "finalize", number>>;
  /** Max review+fix iterations */
  maxReviewIterations?: number;
  /** Max test attempts */
  maxTestAttempts?: number;
  /** Max test-fix-review resets */
  maxPhaseResets?: number;
  /** Phases to run. Default: ["implement", "review", "test", "finalize"]. */
  phases?: PhaseName[];
}

export interface CiConfig {
  /** Port for webhook server */
  port?: number;
  /** Log directory */
  logDir?: string;
  /** Max concurrent pipelines across all projects */
  maxConcurrent?: number;
  /** Max queue size */
  maxQueueSize?: number;
  /** Linear webhook secret (can also be set via LINEAR_WEBHOOK_SECRET env var) */
  linearWebhookSecret?: string;
  /** Linear bot user ID (can also be set via CLAUDE_BOT_USER_ID env var) */
  claudeBotUserId?: string;
  /** Default phase budgets (USD) */
  budgets?: Record<string, number>;
  /** Default phase timeouts (ms) */
  timeouts?: Record<string, number>;
  /** Default iteration limits */
  maxReviewIterations?: number;
  maxTestAttempts?: number;
  maxPhaseResets?: number;
  /** Dedup TTL (ms) */
  dedupTtl?: number;
  /** Project definitions */
  projects: ProjectConfig[];
}

export function defineConfig(config: CiConfig): CiConfig {
  return config;
}
