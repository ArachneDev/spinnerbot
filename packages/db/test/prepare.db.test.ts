import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, prepareDatabase } from "@scrimbot/db";

const url = process.env["TEST_DATABASE_URL"];
if (!url) throw new Error("Set TEST_DATABASE_URL");

const asRole = (role: string, password: string) => {
  const u = new URL(url);
  u.username = role;
  u.password = password;
  return u.toString();
};

const opened: ReturnType<typeof createDatabase>[] = [];
afterAll(() => Promise.all(opened.map((handle) => handle.sql.end())));

describe("prepareDatabase", () => {
  it("migrates and gives each role the password in its URL, so it can log in", async () => {
    const web = asRole("scrimbot_web", "web p@ss/1");
    const bot = asRole("scrimbot_bot", "bot-pass-2");
    await prepareDatabase({ owner: url, web, bot });
    await prepareDatabase({ owner: url, web, bot }); // safe to repeat

    for (const [role, roleUrl] of [
      ["scrimbot_web", web],
      ["scrimbot_bot", bot],
    ] as const) {
      const handle = createDatabase(roleUrl, { max: 1 });
      opened.push(handle);
      const [row] = await handle.sql`select current_user as name`;
      expect(row?.["name"]).toBe(role);
    }
  });
});
