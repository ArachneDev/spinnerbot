import { type JobType, isJobType, parseJobPayload } from "@scrimbot/core";
import {
  type ClaimedJob,
  JOBS_CHANNEL,
  claimJob,
  completeJob,
  failJob,
  purgeExpiredRosters,
  purgeFinishedJobs,
  releaseStaleJobs,
} from "@scrimbot/db";
import type { Registry } from "./registry.js";
import type { FeatureContext } from "./types.js";

const POLL_INTERVAL_MS = 5_000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export interface JobWorker {
  /** Runs jobs until none are due. Exposed so tests can drive the worker directly. */
  drain(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Runs web-to-bot jobs. Notifications make it prompt, and polling means a missed notification
 * only delays a job.
 */
export function createJobWorker(registry: Registry, context: FeatureContext): JobWorker {
  const { db, sql } = context.database;
  let timer: NodeJS.Timeout | undefined;
  let purgeTimer: NodeJS.Timeout | undefined;
  let unlisten: (() => Promise<void>) | undefined;
  let draining: Promise<void> | undefined;
  let wakeAgain = false;
  let stopped = false;

  async function run(job: ClaimedJob): Promise<void> {
    const log = context.log.child({ job: job.id, type: job.type, attempt: job.attempts });
    const registered = isJobType(job.type) ? registry.jobs.get(job.type as JobType) : undefined;
    if (!registered) {
      log.error("No handler for job");
      await failJob(db, job, `No handler for job type "${job.type}"`);
      return;
    }
    try {
      const payload = parseJobPayload(job.type as JobType, job.payload);
      await registered.handler.execute(payload, { ...context, log });
      await completeJob(db, job.id);
    } catch (error) {
      log.error({ err: error }, "Job failed");
      await failJob(db, job, error instanceof Error ? error.message : String(error));
    }
  }

  async function drainOnce(): Promise<void> {
    await releaseStaleJobs(db);
    for (;;) {
      if (stopped) return;
      const job = await claimJob(db);
      if (!job) return;
      await run(job);
    }
  }

  /** One drain at a time. A wake-up during a drain runs one more, so nothing is left waiting. */
  function drain(): Promise<void> {
    if (draining) {
      wakeAgain = true;
      return draining;
    }
    draining = (async () => {
      try {
        do {
          wakeAgain = false;
          await drainOnce();
        } while (wakeAgain && !stopped);
      } finally {
        draining = undefined;
      }
    })();
    return draining;
  }

  function purge(): void {
    void Promise.all([purgeFinishedJobs(db), purgeExpiredRosters(db)])
      .then(([jobs, rosters]) => {
        if (jobs + rosters > 0) context.log.info({ jobs, rosters }, "Deleted expired data");
      })
      .catch((error: unknown) => context.log.warn({ err: error }, "Cleanup failed"));
  }

  function wake(): void {
    void drain().catch((error: unknown) => context.log.error({ err: error }, "Job drain failed"));
  }

  return {
    drain,
    async start() {
      const subscription = await sql.listen(JOBS_CHANNEL, wake);
      unlisten = () => subscription.unlisten();
      timer = setInterval(wake, POLL_INTERVAL_MS);
      purgeTimer = setInterval(purge, PURGE_INTERVAL_MS);
      purge();
      wake();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (purgeTimer) clearInterval(purgeTimer);
      await unlisten?.();
      await draining;
    },
  };
}
