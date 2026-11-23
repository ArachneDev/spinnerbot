import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseHandle } from "@scrimbot/db";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { warnMissingBrand } from "../server/brand.js";

const log = pino({ level: "silent" });
const database = {} as DatabaseHandle;
const dir = mkdtempSync(join(tmpdir(), "brand-"));
const app = createApp({ database, log }, { features: [], assetsDir: dir });

beforeAll(() => {
  writeFileSync(join(dir, "arachne-crest.png"), "png bytes");
  // In the folder, but not one of the served names.
  writeFileSync(join(dir, "secret.txt"), "not art");
  mkdirSync(join(dir, "emblems"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("/brand/", () => {
  it("serves a file from the assets folder", async () => {
    const response = await app.request("/brand/arachne-crest.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("png bytes");
  });

  it("answers 404 for a known name whose file is missing", async () => {
    expect((await app.request("/brand/hero-battlefield.jpg")).status).toBe(404);
  });

  it("answers 404 for any name that is not one of the art files", async () => {
    expect((await app.request("/brand/secret.txt")).status).toBe(404);
    expect((await app.request("/brand/emblems")).status).toBe(404);
  });

  it("refuses a path that climbs out of the folder", async () => {
    for (const path of [
      "/brand/..%2Fsecret.txt",
      "/brand/%2e%2e%2farachne-crest.png",
      "/brand/../arachne-crest.png",
      "/brand/emblems/../secret.txt",
    ]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it("keeps health checks working with no art at all", async () => {
    const bare = createApp(
      { database: { sql: async () => [] } as unknown as DatabaseHandle, log },
      { features: [], assetsDir: join(dir, "nowhere") },
    );
    expect((await bare.request("/healthz")).status).toBe(200);
    expect((await bare.request("/brand/arachne-crest.png")).status).toBe(404);
  });

  it("warns once for each missing file at start-up", () => {
    const warn = vi.fn();
    warnMissingBrand(dir, { warn } as never);
    // The crest is there, so the other four names are missing.
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
