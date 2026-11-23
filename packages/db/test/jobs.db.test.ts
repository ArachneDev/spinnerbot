import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  JOBS_CHANNEL,
  claimJob,
  completeJob,
  createDatabase,
  enqueueJob,
  failJob,
  purgeFinishedJobs,
  releaseStaleJobs,
  runMigrations,
  schema,
} from "@scrimbot/db";

const url = process.env["TEST_DATABASE_URL"];
if (!url) throw new Error("Set TEST_DATABASE_URL");

const handle = createDatabase(url);
const { db, sql: client } = handle;

beforeAll(() => runMigrations(url));
afterAll(() => client.end());
beforeEach(() => db.delete(schema.botJobs));

describe("job queue", () => {
  it("runs a job through to done", async () => {
    const id = await enqueueJob(db, "system.heartbeat", { note: "a" });
    const job = await claimJob(db);
    expect(job).toMatchObject({ id, type: "system.heartbeat", attempts: 1 });
    expect(await claimJob(db)).toBeNull();
    await completeJob(db, id);
    const [row] = await db.select().from(schema.botJobs).where(eq(schema.botJobs.id, id));
    expect(row?.status).toBe("done");
  });

  it("gives a job to only one of several workers", async () => {
    await enqueueJob(db, "system.heartbeat", {});
    const claims = await Promise.all([claimJob(db), claimJob(db), claimJob(db)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("drops the job when the surrounding transaction rolls back", async () => {
    await expect(
      db.transaction(async (tx) => {
        await enqueueJob(tx, "system.heartbeat", {});
        throw new Error("data change failed");
      }),
    ).rejects.toThrow("data change failed");
    expect(await claimJob(db)).toBeNull();
  });

  it("notifies listeners on commit", async () => {
    const received = new Promise<string>((resolve) => {
      void client.listen(JOBS_CHANNEL, resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const id = await enqueueJob(db, "system.heartbeat", {});
    expect(await received).toBe(String(id));
  });

  it("backs off after a failure and gives up after five attempts", async () => {
    const id = await enqueueJob(db, "system.heartbeat", {});
    const first = await claimJob(db);
    await failJob(db, first!, "boom");
    expect(await claimJob(db)).toBeNull();

    await db.execute(sql`update bot_jobs set run_after = now(), attempts = 4 where id = ${id}`);
    const last = await claimJob(db);
    await failJob(db, last!, "boom again");
    const [row] = await db.select().from(schema.botJobs).where(eq(schema.botJobs.id, id));
    expect(row).toMatchObject({ status: "failed", lastError: "boom again" });
  });

  it("recovers a job from a crashed worker", async () => {
    await enqueueJob(db, "system.heartbeat", {});
    await claimJob(db);
    expect(await releaseStaleJobs(db)).toBe(0);
    await db.execute(sql`update bot_jobs set locked_at = now() - interval '1 hour'`);
    expect(await releaseStaleJobs(db)).toBe(1);
    expect(await claimJob(db)).not.toBeNull();
  });
});

describe("job cleanup", () => {
  it("deletes old finished jobs and keeps everything else", async () => {
    const old = "now() - interval '2 days'";
    await db.execute(
      sql.raw(`
      insert into bot_jobs (type, status, finished_at) values
        ('system.heartbeat', 'done', ${old}),
        ('system.heartbeat', 'done', now()),
        ('system.heartbeat', 'failed', ${old}),
        ('system.heartbeat', 'failed', now() - interval '8 days'),
        ('system.heartbeat', 'pending', null),
        ('system.heartbeat', 'running', null)`),
    );
    expect(await purgeFinishedJobs(db)).toBe(2);
    const left = await db.select().from(schema.botJobs);
    expect(left.map((j) => j.status).sort()).toEqual(["done", "failed", "pending", "running"]);
  });
});

describe("database roles", () => {
  const rollback = new Error("rollback");

  /** Runs statements as a role, then undoes them. */
  async function asRole(role: string, statements: string[]) {
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        for (const statement of statements) await tx.unsafe(statement);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }

  const isDenied = (role: string, statement: string) =>
    expect(asRole(role, [statement])).rejects.toThrow(/permission denied/);

  it("lets the web role queue jobs and write audit entries", async () => {
    await asRole("scrimbot_web", [
      "insert into bot_jobs (type, payload) values ('system.heartbeat', '{}') returning id",
      "select pg_notify('bot_jobs', 'x')",
      "insert into audit_log (actor, action) values ('web', 'test')",
    ]);
  });

  it("lets the web role queue a job through enqueueJob itself", async () => {
    // Drizzle's own insert lists every column, which the web role's narrow grant forbids, so this
    // connects as the web role and uses the same helper the web app does.
    await client.unsafe(`alter role scrimbot_web login password 'web-test-password'`);
    const webUrl = new URL(url);
    webUrl.username = "scrimbot_web";
    webUrl.password = "web-test-password";
    const web = createDatabase(webUrl.toString());
    try {
      await expect(
        web.db.transaction(async (tx) => {
          await enqueueJob(tx, "system.heartbeat", { note: "from web" });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      const id = await enqueueJob(web.db, "system.heartbeat", { note: "from web" });
      expect(id).toBeGreaterThan(0);
    } finally {
      await web.sql.end();
    }
  });

  it.each([
    "select * from bot_jobs",
    "update bot_jobs set status = 'done'",
    "delete from bot_jobs",
    "insert into bot_jobs (type, status) values ('x', 'done')",
    "select * from audit_log",
    "delete from audit_log",
    "update guilds set name = 'x'",
  ])("denies the web role: %s", async (statement) => {
    await isDenied("scrimbot_web", statement);
  });

  it("lets the bot role run jobs and write audit entries", async () => {
    await asRole("scrimbot_bot", [
      "select * from bot_jobs",
      "update bot_jobs set status = 'done'",
      "insert into guilds (id, name) values ('1', 'test')",
      "insert into audit_log (actor, action) values ('bot', 'test')",
      "delete from bot_jobs",
    ]);
  });

  it.each(["delete from audit_log", "update audit_log set actor = 'x'"])(
    "denies the bot role: %s",
    async (statement) => {
      await isDenied("scrimbot_bot", statement);
    },
  );
});
