import { getConfig } from "../config.js";
import { log } from "./logger.js";
import { runPipeline } from "./index.js";
import type { ResolvedProjectConfig } from "../resolve-config.js";

export interface Job {
  issueId: string;
  issueTitle: string;
  issueDescription: string;
  branchName: string;
  teamKey: string;
  project: ResolvedProjectConfig;
}

const activeJobs = new Map<string, Job>();
const pendingQueue: Job[] = [];

export function isProcessing(issueId: string): boolean {
  return (
    activeJobs.has(issueId) ||
    pendingQueue.some((j) => j.issueId === issueId)
  );
}

export function enqueue(job: Job): boolean {
  const config = getConfig();
  if (isProcessing(job.issueId)) return false;
  if (pendingQueue.length >= config.maxQueueSize) return false;

  if (activeJobs.size < config.maxConcurrent) {
    startJob(job);
  } else {
    pendingQueue.push(job);
    log("info", `Queued (position ${pendingQueue.length})`, job.issueId);
  }

  return true;
}

function startJob(job: Job) {
  activeJobs.set(job.issueId, job);
  log("info", `Starting pipeline`, job.issueId);

  runPipeline(job)
    .catch((err) => {
      log("error", `Pipeline crashed: ${err}`, job.issueId);
    })
    .finally(() => {
      activeJobs.delete(job.issueId);
      processNext();
    });
}

function processNext() {
  const config = getConfig();
  if (activeJobs.size >= config.maxConcurrent) return;
  const next = pendingQueue.shift();
  if (next) startJob(next);
}
