import { createDatabase, enqueueJob, runMigrations, schema } from "@scrimbot/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createJobWorker } from "../src/framework/job-worker.js";
import { buildRegistry } from "../src/framework/registry.js";
import { defineJob } from "../src/framework/types.js";
import { fakeContext } from "./helpers.js";

const url = process.env["TEST_DATABASE_URL"];
if (!url) throw new Error("Set TEST_DATABASE_URL");
const database = createDatabase(url);

beforeAll(() => runMigrations(url));
afterAll(() => database.sql.end());
beforeEach(() => database.db.delete(schema.botJobs));

const row = async (id: number) => {
  const [job] = await database.sql`select status, last_error from bot_jobs where id = ${id}`;
  return job;
};
const status = async (id: number) => (await row(id))?.["status"];

function workerWith(execute: () => Promise<void>) {
  const registry = buildRegistry([
    { name: "demo", jobs: [defineJob({ type: "system.heartbeat", execute })] },
  ]);
  return createJobWorker(registry, { ...fakeContext(), database });
}

describe("job worker", () => {
  it("wakes on a notification rather than waiting for the poll", async () => {
    const execute = vi.fn(async () => {});
    const worker = workerWith(execute);
    await worker.start();
    await enqueueJob(database.db, "system.heartbeat", {});
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce(), { timeout: 2000 });
    await worker.stop();
  });

  it("records a failing handler without stopping later jobs", async () => {
    const execute = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue();
    const worker = workerWith(execute);
    const failing = await enqueueJob(database.db, "system.heartbeat", {});
    const healthy = await enqueueJob(database.db, "system.heartbeat", {});
    await worker.drain();
    expect(await status(failing)).toBe("pending");
    expect(await status(healthy)).toBe("done");
  });

  it("fails a job type nothing handles", async () => {
    const worker = createJobWorker(buildRegistry([]), { ...fakeContext(), database });
    const [job] = await database.db
      .insert(schema.botJobs)
      .values({ type: "not.listed" })
      .returning();
    await worker.drain();
    expect((await row(job!.id))?.["last_error"]).toMatch(/No handler/);
  });
});
