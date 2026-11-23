import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/framework/config.js";

const dirs: string[] = [];
function write(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "config-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true })));

const base = {
  DISCORD_APPLICATION_ID: "1",
  PUBLIC_URL: "https://example.test/",
  DATABASE_URL: "postgres://a:b@db/x",
};

describe("loadConfig", () => {
  it("reads the Discord token from the secrets file, not the environment", () => {
    const file = write("app.json", JSON.stringify({ DISCORD_TOKEN: "from-file" }));
    const config = loadConfig({ ...base, APP_SECRETS_FILE: file, DISCORD_TOKEN: "from-env" });
    expect(config.discordToken).toBe("from-file");
    expect(config.publicUrl).toBe("https://example.test");
  });

  it("falls back to the environment when there is no secrets file (development)", () => {
    const missing = join(tmpdir(), "no-such-app.json");
    expect(
      loadConfig({ ...base, APP_SECRETS_FILE: missing, DISCORD_TOKEN: "dev" }).discordToken,
    ).toBe("dev");
  });

  it("names the missing key", () => {
    const file = write("app.json", "{}");
    expect(() => loadConfig({ ...base, APP_SECRETS_FILE: file })).toThrow(/DISCORD_TOKEN/);
  });

  it("reads each database URL from its file", () => {
    const secrets = write("app.json", JSON.stringify({ DISCORD_TOKEN: "t" }));
    const config = loadConfig({
      ...base,
      DATABASE_URL: undefined,
      APP_SECRETS_FILE: secrets,
      DATABASE_URL_FILE: write("bot", "postgres://bot@db/x\n"),
      DATABASE_OWNER_URL_FILE: write("owner", "postgres://owner@db/x"),
      DATABASE_WEB_URL_FILE: write("web", "postgres://web@db/x"),
    });
    expect(config.databaseUrl).toBe("postgres://bot@db/x");
    expect(config.ownerDatabaseUrl).toBe("postgres://owner@db/x");
    expect(config.webDatabaseUrl).toBe("postgres://web@db/x");
  });

  it("needs the web URL when it has the owner URL", () => {
    const secrets = write("app.json", JSON.stringify({ DISCORD_TOKEN: "t" }));
    expect(() =>
      loadConfig({
        ...base,
        APP_SECRETS_FILE: secrets,
        DATABASE_OWNER_URL_FILE: write("owner", "postgres://owner@db/x"),
      }),
    ).toThrow(/DATABASE_WEB_URL_FILE/);
  });
});
