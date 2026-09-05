import crypto from "node:crypto";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createDefaultDependencies, handleJob, type WorkerDependencies } from "./handlers";
import { claimNextJob, completeJob, failJob, recoverStaleJobs } from "./queue";
import { ensureDailyDiscoveryJobs } from "./scheduler";

const workerId = `worker-${crypto.randomUUID()}`;

export async function runWorkerIteration(dependencies: WorkerDependencies): Promise<boolean> {
  const job = claimNextJob(workerId);
  if (!job) return false;
  try {
    await handleJob(job, dependencies);
    completeJob(job.id);
  } catch (error) {
    failJob(job, error);
    logger.error({ jobId: job.id, type: job.type, error: error instanceof Error ? error.message : String(error) }, "Worker job failed");
  }
  return true;
}

async function main(): Promise<void> {
  recoverStaleJobs();
  let dependencies: WorkerDependencies;
  try {
    dependencies = createDefaultDependencies();
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Worker started without OpenAI credentials; AI jobs will remain retryable");
    const unavailable = new Proxy({}, { get: () => async () => { throw new Error("OPENAI_API_KEY is not configured."); } });
    dependencies = { conversationEngine: unavailable as unknown as WorkerDependencies["conversationEngine"], browserGateway: new (await import("@/integrations/browser/gateway")).PlaywrightCdpGateway() };
  }
  logger.info({ workerId }, "Durable worker started");
  while (true) {
    const dailyJobs = ensureDailyDiscoveryJobs();
    if (dailyJobs) logger.info({ dailyJobs }, "Automatic weekday discovery jobs queued");
    const processed = await runWorkerIteration(dependencies);
    if (!processed) await new Promise((resolve) => setTimeout(resolve, getEnv().WORKER_POLL_INTERVAL_MS));
  }
}

if (process.env.NODE_ENV !== "test") void main();
