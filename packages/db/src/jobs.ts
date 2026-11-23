import { type JobPayload, type JobType, isJobType, parseJobPayload } from "@scrimbot/core";
import { sql } from "drizzle-orm";
import type { Database, Executor } from "./client.js";

export const JOBS_CHANNEL = "bot_jobs";

const MAX_ATTEMPTS = 5;
/** A running job older than this belongs to a crashed worker and is retried. */
const STALE_AFTER_SECONDS = 300;

export interface ClaimedJob {
  id: number;
  type: string;
  payload: unknown;
  attempts: number;
}

/**
 * Queues a job. Pass the open transaction as `executor` so the job exists only if the data
 * change commits. The notification is delivered at commit too.
 *
 * The insert names only `type` and `payload` on purpose. The web role may write just those two
 * columns, and Postgres checks every column an INSERT names, even ones left to their defaults,
 * so a query built by the ORM (which names them all) is refused for that role.
 */
export async function enqueueJob<T extends JobType>(
  executor: Executor,
  type: T,
  payload: JobPayload<T>,
): Promise<number> {
  const parsed = parseJobPayload(type, payload);
  const [row] = await executor.execute<{ id: string }>(sql`
    insert into bot_jobs (type, payload) values (${type}, ${JSON.stringify(parsed)}::jsonb)
    returning id
  `);
  const id = Number(row!.id);
  await executor.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${String(id)})`);
  return id;
}

/** Claims one due job, or returns null. Safe with several workers. */
export async function claimJob(db: Database): Promise<ClaimedJob | null> {
  const rows = await db.execute<{
    id: string;
    type: string;
    payload: unknown;
    attempts: number;
  }>(sql`
    update bot_jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from bot_jobs
      where status = 'pending' and run_after <= now()
      order by run_after, id
      for update skip locked
      limit 1
    )
    returning id, type, payload, attempts
  `);
  const row = rows[0];
  return row ? { ...row, id: Number(row.id) } : null;
}

export async function completeJob(db: Database, id: number): Promise<void> {
  await db.execute(sql`
    update bot_jobs set status = 'done', finished_at = now(), locked_at = null, last_error = null
    where id = ${id}
  `);
}

/** Retries with exponential backoff, then marks the job failed for good. */
export async function failJob(db: Database, job: ClaimedJob, error: string): Promise<void> {
  const backoffSeconds = 2 ** job.attempts * 5;
  await db.execute(sql`
    update bot_jobs set
      status = case when attempts >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end,
      finished_at = case when attempts >= ${MAX_ATTEMPTS} then now() end,
      run_after = now() + make_interval(secs => ${backoffSeconds}),
      locked_at = null,
      last_error = ${error.slice(0, 2000)}
    where id = ${job.id}
  `);
}

/** Returns jobs abandoned by a crashed worker to the queue. */
export async function releaseStaleJobs(db: Database): Promise<number> {
  const rows = await db.execute(sql`
    update bot_jobs set
      status = case when attempts >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end,
      finished_at = case when attempts >= ${MAX_ATTEMPTS} then now() end,
      locked_at = null,
      last_error = 'worker stopped while running this job'
    where status = 'running' and locked_at < now() - make_interval(secs => ${STALE_AFTER_SECONDS})
    returning id
  `);
  return rows.length;
}

/** Finished jobs are only history. Failed ones stay longer, so someone has time to look. */
const KEEP_DONE_HOURS = 24;
const KEEP_FAILED_DAYS = 7;

/** Deletes old finished jobs so the queue table stays small. Never touches pending or running. */
export async function purgeFinishedJobs(db: Database): Promise<number> {
  const rows = await db.execute(sql`
    delete from bot_jobs
    where (status = 'done' and finished_at < now() - make_interval(hours => ${KEEP_DONE_HOURS}))
       or (status = 'failed' and finished_at < now() - make_interval(days => ${KEEP_FAILED_DAYS}))
    returning id
  `);
  return rows.length;
}

export { isJobType };
