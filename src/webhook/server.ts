import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig, getConfig, getProject } from "../config.js";
import { verifyLinearSignature } from "./verify.js";
import { enqueue, isProcessing } from "../orchestrator/queue.js";
import { log } from "../orchestrator/logger.js";

interface LinearWebhookPayload {
  action: string;
  type: string;
  data: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    assignee?: { id: string };
    state?: { name: string };
    team?: { id: string; key: string };
    branchName?: string;
  };
  updatedFrom?: Record<string, unknown>;
}

// Dedup: recently completed issues (issueId -> completion timestamp)
const recentlyCompleted = new Map<string, number>();

function cleanupCompleted() {
  const ttl = getConfig().dedupTtl;
  const now = Date.now();
  for (const [id, ts] of recentlyCompleted) {
    if (now - ts > ttl) recentlyCompleted.delete(id);
  }
}

function shouldTrigger(payload: LinearWebhookPayload): boolean {
  if (payload.type !== "Issue") return false;

  const config = getConfig();
  const { action, data, updatedFrom } = payload;

  // Trigger 1: Assigned to bot (on create or update)
  if (data.assignee?.id === config.claudeBotUserId) {
    // On update, only trigger if assignee actually changed
    if (action === "update" && !updatedFrom?.assigneeId) return false;
    return true;
  }

  // Trigger 2: @claude mentioned in description
  if (data.description && /@claude/i.test(data.description)) {
    // On update, only trigger if description actually changed
    if (action === "update" && !updatedFrom?.description) return false;
    return true;
  }

  return false;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST" || req.url !== "/webhook/linear") {
    json(res, 404, { error: "not found" });
    return;
  }

  const config = getConfig();
  const rawBody = await readBody(req);
  const signature = req.headers["linear-signature"] as string | undefined;

  if (!signature || !verifyLinearSignature(rawBody, signature, config.linearWebhookSecret)) {
    log("warn", "Webhook signature verification failed");
    json(res, 401, { error: "invalid signature" });
    return;
  }

  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString()) as LinearWebhookPayload;
  } catch {
    json(res, 400, { error: "invalid JSON" });
    return;
  }

  // Always respond 200 quickly (Linear expects fast responses)
  json(res, 200, { received: true });

  // Check trigger conditions
  if (!shouldTrigger(payload)) return;

  const issueId = payload.data.identifier;
  const teamKey = payload.data.team?.key ?? "";

  // Resolve project from team key
  const project = getProject(teamKey);
  if (!project) {
    log("warn", `No project configured for team key "${teamKey}", skipping issue ${issueId}`);
    return;
  }

  // Dedup checks
  cleanupCompleted();
  if (isProcessing(issueId)) {
    log("info", `Issue ${issueId} already being processed, skipping`);
    return;
  }
  if (recentlyCompleted.has(issueId)) {
    log("info", `Issue ${issueId} recently completed, skipping`);
    return;
  }

  const enqueued = enqueue({
    issueId,
    issueTitle: payload.data.title,
    issueDescription: payload.data.description ?? "",
    branchName: payload.data.branchName ?? "",
    teamKey,
    project,
  });

  if (enqueued) {
    log("info", `Issue ${issueId} enqueued for processing (project: ${teamKey})`, issueId);
  } else {
    log("warn", `Queue full, rejected issue ${issueId}`);
  }
}

export function markCompleted(issueId: string) {
  recentlyCompleted.set(issueId, Date.now());
}

export async function startServer() {
  const config = await loadConfig();

  log("info", `Loaded ${config.projects.length} project(s): ${[...config.projectsByTeamKey.keys()].join(", ")}`);

  const server = createServer((req, res) => {
    handleWebhook(req, res).catch((err) => {
      log("error", `Webhook handler error: ${err}`);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
    });
  });

  server.listen(config.port, () => {
    log("info", `taky-ci webhook receiver listening on port ${config.port}`);
  });

  return server;
}

// Entry point
startServer();
