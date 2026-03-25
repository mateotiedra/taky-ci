import { env } from "node:process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CiConfig, PhaseName, SkillsConfig, OutputPatterns } from "./schema.js";

export interface ResolvedProjectConfig {
  repoPath: string;
  baseBranch: string;
  teamKeys: string[];
  model: "opus" | "sonnet" | "haiku";
  implementPrompt: string;
  skills: Required<{ [K in keyof SkillsConfig]: string | null }>;
  patterns: {
    reviewClean: RegExp[];
    reviewReportPath: RegExp;
    reviewSummary: RegExp;
    testVerdict: RegExp;
  };
  budgets: Record<string, number>;
  timeouts: Record<string, number>;
  maxReviewIterations: number;
  maxTestAttempts: number;
  maxPhaseResets: number;
  phases: PhaseName[];
}

export interface ResolvedConfig {
  port: number;
  logDir: string;
  maxConcurrent: number;
  maxQueueSize: number;
  linearWebhookSecret: string;
  claudeBotUserId: string;
  dedupTtl: number;
  projects: ResolvedProjectConfig[];
  projectsByTeamKey: Map<string, ResolvedProjectConfig>;
}

const DEFAULT_BUDGETS: Record<string, number> = {
  intake: 0.5,
  implement: 5,
  review: 3,
  fix: 3,
  test: 3,
  finalize: 0.5,
};

const DEFAULT_TIMEOUTS: Record<string, number> = {
  intake: 3 * 60_000,
  implement: 20 * 60_000,
  review: 10 * 60_000,
  fix: 10 * 60_000,
  test: 10 * 60_000,
  finalize: 5 * 60_000,
};

const DEFAULT_PATTERNS = {
  reviewClean: [
    /all checks passed/i,
    /0 must fix,?\s*0 should fix/i,
    /nothing to fix/i,
  ],
  reviewReportPath: /Report saved to:\s*(.+)/,
  reviewSummary:
    /Summary:\s*(\d+)\s*must fix,\s*(\d+)\s*should fix,\s*(\d+)\s*to consider/i,
  testVerdict: /VERDICT:\s*(PASS|FAIL|NEEDS_ATTENTION)/i,
};

const DEFAULT_PHASES: PhaseName[] = ["implement", "review", "test", "finalize"];

function requiredEnv(name: string, configValue?: string): string {
  const value = configValue || env[name];
  if (!value) throw new Error(`Missing required config/env: ${name}`);
  return value;
}

function resolveProject(
  project: CiConfig["projects"][number],
  globalConfig: CiConfig
): ResolvedProjectConfig {
  if (!existsSync(project.repoPath)) {
    throw new Error(`Project repoPath does not exist: ${project.repoPath}`);
  }
  if (project.teamKeys.length === 0) {
    throw new Error(`Project at ${project.repoPath} has no teamKeys`);
  }

  const globalBudgets = { ...DEFAULT_BUDGETS, ...globalConfig.budgets };
  const globalTimeouts = { ...DEFAULT_TIMEOUTS, ...globalConfig.timeouts };

  return {
    repoPath: project.repoPath,
    baseBranch: project.baseBranch ?? "main",
    teamKeys: project.teamKeys,
    model: project.model ?? "sonnet",
    implementPrompt:
      project.implementPrompt ??
      "You are implementing a feature for this project.",
    skills: {
      review: project.skills?.review ?? null,
      fix: project.skills?.fix ?? null,
      test: project.skills?.test ?? null,
      commit: project.skills?.commit ?? null,
    },
    patterns: {
      reviewClean:
        project.patterns?.reviewClean ?? DEFAULT_PATTERNS.reviewClean,
      reviewReportPath:
        project.patterns?.reviewReportPath ?? DEFAULT_PATTERNS.reviewReportPath,
      reviewSummary:
        project.patterns?.reviewSummary ?? DEFAULT_PATTERNS.reviewSummary,
      testVerdict:
        project.patterns?.testVerdict ?? DEFAULT_PATTERNS.testVerdict,
    },
    budgets: { ...globalBudgets, ...project.budgets },
    timeouts: { ...globalTimeouts, ...project.timeouts },
    maxReviewIterations:
      project.maxReviewIterations ?? globalConfig.maxReviewIterations ?? 3,
    maxTestAttempts:
      project.maxTestAttempts ?? globalConfig.maxTestAttempts ?? 2,
    maxPhaseResets:
      project.maxPhaseResets ?? globalConfig.maxPhaseResets ?? 2,
    phases: project.phases ?? DEFAULT_PHASES,
  };
}

export async function resolveConfig(): Promise<ResolvedConfig> {
  const configPath = env.TAKY_CI_CONFIG
    ? resolve(env.TAKY_CI_CONFIG)
    : resolve("taky-ci.config.js");

  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath}\nCreate one from taky-ci.config.example.ts or set TAKY_CI_CONFIG env var.`
    );
  }

  const mod = await import(configPath);
  const rawConfig: CiConfig = mod.default ?? mod;

  if (!rawConfig.projects || rawConfig.projects.length === 0) {
    throw new Error("Config must define at least one project");
  }

  const projects = rawConfig.projects.map((p) =>
    resolveProject(p, rawConfig)
  );

  // Build team key lookup and check for duplicates
  const projectsByTeamKey = new Map<string, ResolvedProjectConfig>();
  for (const project of projects) {
    for (const key of project.teamKeys) {
      if (projectsByTeamKey.has(key)) {
        throw new Error(
          `Duplicate team key "${key}" found in multiple projects`
        );
      }
      projectsByTeamKey.set(key, project);
    }
  }

  return {
    port: parseInt(String(env.TAKY_CI_PORT ?? rawConfig.port ?? 4177), 10),
    logDir:
      env.TAKY_CI_LOG_DIR ??
      rawConfig.logDir ??
      `${env.HOME}/.claude/ci-logs`,
    maxConcurrent: parseInt(
      String(env.TAKY_CI_MAX_CONCURRENT ?? rawConfig.maxConcurrent ?? 1),
      10
    ),
    maxQueueSize: rawConfig.maxQueueSize ?? 5,
    linearWebhookSecret: requiredEnv(
      "LINEAR_WEBHOOK_SECRET",
      rawConfig.linearWebhookSecret
    ),
    claudeBotUserId: requiredEnv(
      "CLAUDE_BOT_USER_ID",
      rawConfig.claudeBotUserId
    ),
    dedupTtl: rawConfig.dedupTtl ?? 5 * 60_000,
    projects,
    projectsByTeamKey,
  };
}
