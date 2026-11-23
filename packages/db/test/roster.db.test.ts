import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, purgeExpiredRosters, runMigrations } from "@scrimbot/db";

const url = process.env["TEST_DATABASE_URL"];
if (!url) throw new Error("Set TEST_DATABASE_URL");

const { sql: client } = createDatabase(url);

beforeAll(() => runMigrations(url));
afterAll(() => client.end());

const insertRoster =
  "insert into roster_instances (token, guild_id, channel_id, owner_id, source_channel_id, source_message_id, snapshot, expires_at) values ('t', '1', '2', '3', '4', '5', '{}', now() + interval '1 day')";

describe("roster_instances roles", () => {
  const rollback = new Error("rollback");

  /** Runs statements as a role, after seeding a row as the owner, then undoes everything. */
  async function asRole(role: string, statements: string[]) {
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(insertRoster);
        await tx.unsafe(`set local role ${role}`);
        for (const statement of statements) await tx.unsafe(statement);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }

  const isDenied = (role: string, statement: string) =>
    expect(asRole(role, [statement])).rejects.toThrow(/permission denied/);

  it("lets the web role read a roster by token and save assignments", async () => {
    await asRole("scrimbot_web", [
      "select id, snapshot, assignments, status, expires_at from roster_instances where token = 't'",
      `update roster_instances set assignments = '{"0": 1}' where token = 't' returning id`,
      "insert into bot_jobs (type, payload) values ('roster.preview', '{}')",
      "select answer_options, emoji_options from roster_instances where token = 't'",
      `update roster_instances set answer_options = '[]' where token = 't'`,
      "select guild_id, squad_names, squad_leaders, show_banner, show_bench, embed_style from roster_instances where token = 't'",
      `update roster_instances set squad_names = '[]', squad_leaders = '{}', show_banner = true, show_bench = false, embed_style = '{}' where token = 't'`,
      `insert into guild_roster_defaults (guild_id, squad_names) values ('role-test', '[]') on conflict (guild_id) do update set squad_names = '[]', updated_at = now()`,
      "select squad_names from guild_roster_defaults",
      // Changes from the page lock the row, then raise its revision.
      "select id, revision, status from roster_instances where token = 't' for update",
      "update roster_instances set revision = revision + 1 where token = 't' returning revision",
    ]);
  });

  it.each([
    insertRoster,
    "delete from roster_instances",
    "select owner_id from roster_instances",
    "select preview_token from roster_instances",
    "select posted_answer_options from roster_instances",
    "select posted_squad_names, posted_squad_leaders, posted_show_banner, posted_show_bench, posted_embed_style from roster_instances",
    "update roster_instances set posted_squad_names = '[]'",
    "delete from guild_roster_defaults",
    "update roster_instances set emoji_options = '{}'",
    "update roster_instances set posted_answer_options = '[]'",
    "update roster_instances set snapshot = '{}'",
    "update roster_instances set status = 'posted'",
  ])("denies the web role: %s", async (statement) => {
    await isDenied("scrimbot_web", statement);
  });

  it("lets the bot role manage the whole life of an instance", async () => {
    await asRole("scrimbot_bot", [
      "select * from roster_instances",
      "update roster_instances set status = 'posted', posted_message_id = '9'",
      "delete from roster_instances",
    ]);
  });
});

describe("roster_responses roles", () => {
  const rollback = new Error("rollback");

  async function asRole(role: string, statements: string[]) {
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(insertRoster);
        await tx.unsafe(`set local role ${role}`);
        for (const statement of statements) await tx.unsafe(statement);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }

  const answer =
    "insert into roster_responses (instance_id, user_id, answer) select id, 'u', 'confirmed' from roster_instances";

  it("lets the bot role record, change and remove answers", async () => {
    await asRole("scrimbot_bot", [
      answer,
      "update roster_responses set answer = 'denied'",
      "delete from roster_responses",
    ]);
  });

  it("removes answers together with their roster", async () => {
    await asRole("scrimbot_bot", [
      answer,
      "delete from roster_instances",
      "do $$ begin if exists (select 1 from roster_responses) then raise exception 'left over'; end if; end $$",
    ]);
  });

  it.each(["select * from roster_responses", answer, "delete from roster_responses"])(
    "denies the web role: %s",
    async (statement) => {
      await expect(asRole("scrimbot_web", [statement])).rejects.toThrow(/permission denied/);
    },
  );
});

describe("expired roster cleanup", () => {
  it("deletes only expired rosters, with their answers", async () => {
    const { db } = createDatabase(url);
    await client.unsafe("delete from roster_instances");
    const insert = (token: string, expires: string) =>
      client.unsafe(
        `insert into roster_instances (token, guild_id, channel_id, owner_id, source_channel_id, source_message_id, snapshot, expires_at) values ('${token}', '1', '2', '3', '4', '5', '{}', ${expires})`,
      );
    await insert("old", "now() - interval '1 hour'");
    await insert("fresh", "now() + interval '1 hour'");
    await client.unsafe(
      "insert into roster_responses (instance_id, user_id, answer) select id, 'u', 'confirmed' from roster_instances where token = 'old'",
    );
    expect(await purgeExpiredRosters(db)).toBe(1);
    const left = await client.unsafe("select token from roster_instances");
    expect(left.map((r) => r["token"])).toEqual(["fresh"]);
    expect((await client.unsafe("select * from roster_responses")).length).toBe(0);
    await client.unsafe("delete from roster_instances");
  });
});

describe("steam_profiles roles", () => {
  const rollback = new Error("rollback");

  async function asRole(role: string, statements: string[]) {
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        for (const statement of statements) await tx.unsafe(statement);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }

  const insert = "insert into steam_profiles (discord_user_id, steam_id) values ('1', '7656')";

  it("lets the bot link and change a profile", async () => {
    await asRole("scrimbot_bot", [
      insert,
      "select discord_user_id, steam_id from steam_profiles",
      `${insert} on conflict (discord_user_id) do update set steam_id = '7657', updated_at = now()`,
      `insert into steam_profiles (discord_user_id, steam_id) values ('2', '7657') on conflict do nothing`,
      "delete from steam_profiles",
    ]);
  });

  it("keeps the web role out", async () => {
    await expect(asRole("scrimbot_web", ["select * from steam_profiles"])).rejects.toThrow(
      /permission denied/,
    );
    await expect(asRole("scrimbot_web", [insert])).rejects.toThrow(/permission denied/);
  });

  it("allows one Discord user per Steam account", async () => {
    await expect(
      asRole("scrimbot_bot", [
        insert,
        "insert into steam_profiles (discord_user_id, steam_id) values ('2', '7656')",
      ]),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("staff_roles roles", () => {
  const rollback = new Error("rollback");

  async function asRole(role: string, statements: string[]) {
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        for (const statement of statements) await tx.unsafe(statement);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }

  const insert = "insert into staff_roles (guild_id, role_id) values ('1', '2')";

  it("lets the bot list, add and remove a role", async () => {
    await asRole("scrimbot_bot", [
      "select role_id from staff_roles where guild_id = '1' order by created_at",
      `${insert} on conflict do nothing returning role_id`,
      "delete from staff_roles where guild_id = '1' and role_id = '2' returning role_id",
    ]);
  });

  it("keeps the web role out", async () => {
    await expect(asRole("scrimbot_web", ["select * from staff_roles"])).rejects.toThrow(
      /permission denied/,
    );
    await expect(asRole("scrimbot_web", [insert])).rejects.toThrow(/permission denied/);
  });

  it("holds a role once per server", async () => {
    await expect(asRole("scrimbot_bot", [insert, insert])).rejects.toThrow(/duplicate key/);
  });
});
