import type { DatabaseHandle } from "@scrimbot/db";
import { Hono } from "hono";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { webFeatures } from "../server/features/index.js";

const log = pino({ level: "silent" });

function database(healthy: boolean) {
  const sql = async () => {
    if (!healthy) throw new Error("connection refused");
    return [];
  };
  return { sql } as unknown as DatabaseHandle;
}

const app = (healthy = true, features = webFeatures) =>
  createApp({ database: database(healthy), log }, { features });

describe("web server", () => {
  it("stays healthy during a database outage but reports not ready", async () => {
    const down = app(false);
    expect((await down.request("/healthz")).status).toBe(200);
    expect((await down.request("/readyz")).status).toBe(503);
    expect((await app(true).request("/readyz")).status).toBe(200);
  });

  it("names the build version in /healthz, which the release pipeline checks", async () => {
    process.env["VERSION"] = "v9.9.9";
    try {
      expect(await (await app().request("/healthz")).json()).toEqual({
        status: "ok",
        version: "v9.9.9",
      });
    } finally {
      delete process.env["VERSION"];
    }
  });

  it("mounts features under /api/<name>", async () => {
    const response = await app().request("/api/system/version");
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("version");
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const response = await app().request("/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("sends security headers", async () => {
    const response = await app().request("/healthz");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("keeps a failing feature's details out of the response", async () => {
    const broken = {
      name: "broken",
      routes: () =>
        new Hono().get("/", () => {
          throw new Error("secret detail");
        }),
    };
    const response = await app(true, [broken]).request("/api/broken");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret detail");
  });

  it("rejects duplicate feature names", () => {
    expect(() => app(true, [...webFeatures, ...webFeatures])).toThrow(/Duplicate/);
  });

  it("hands a join link over to Steam", async () => {
    const response = await app().request(
      "/api/join-lobby/686810/109775241000000000/76561198000000010",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'href="steam://joinlobby/686810/109775241000000000/76561198000000010"',
    );
  });

  it("refuses join links that aren't only digits", async () => {
    for (const path of ["1/2/x", "1/2/3%22%3E%3Cscript%3E", "javascript:alert(1)/2/3", "1/2"]) {
      expect((await app().request(`/api/join-lobby/${path}`)).status).toBe(404);
    }
  });
});
