import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, runMigrations, schema } from "@scrimbot/db";
import { createApp } from "../server/app.js";
import { createRosterFeature } from "../server/features/roster/index.js";

const url = process.env["TEST_DATABASE_URL"];
if (!url) throw new Error("Set TEST_DATABASE_URL");

// Data is set up as the owner. The app itself connects as scrimbot_web, so it runs under the
// same column-level grants as in production. As the owner it would hide missing permissions.
const database = createDatabase(url);
const WEB_PASSWORD = "web-test-password";
const webUrl = new URL(url);
webUrl.username = "scrimbot_web";
webUrl.password = WEB_PASSWORD;
const webDatabase = createDatabase(webUrl.toString());
const app = createApp(
  { database: webDatabase, log: pino({ level: "silent" }) },
  // Every change queues its own preview redraw here, so counting them is exact.
  { features: [createRosterFeature({ previewGapMs: 0 })] },
);

const snapshot = {
  title: "Scrim",
  complete: true,
  responses: {
    accepted: [{ displayName: "A" }, { displayName: "B" }],
    declined: [],
    tentative: [],
  },
};

const insert = (values: Partial<typeof schema.rosterInstances.$inferInsert> = {}) =>
  database.db.insert(schema.rosterInstances).values({
    token: "tok",
    guildId: "1",
    channelId: "2",
    ownerId: "3",
    sourceChannelId: "4",
    sourceMessageId: "5",
    snapshot,
    expiresAt: new Date(Date.now() + 60_000),
    ...values,
  });

beforeAll(async () => {
  await runMigrations(url);
  await database.sql.unsafe(`alter role scrimbot_web login password '${WEB_PASSWORD}'`);
});
afterAll(async () => {
  await webDatabase.sql.end();
  await database.sql.end();
});
beforeEach(async () => {
  await database.db.delete(schema.rosterInstances);
  await database.db.delete(schema.botJobs);
  await database.db.delete(schema.guildRosterDefaults);
});

const put = (path: string, body: unknown) =>
  app.request(`/api/roster/${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

let opId = 0;
/** Sends changes the way the page does. */
const ops = (token: string, changes: object[], clientId = "page-1") =>
  app.request(`/api/roster/${token}/ops`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId, ops: changes.map((op) => ({ id: `op${++opId}`, op })) }),
  });
const board = async (token = "tok") =>
  (await (await app.request(`/api/roster/${token}`)).json()) as Record<string, unknown>;
const jobs = () => database.db.select().from(schema.botJobs);

describe("roster API", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];

  it("applies changes in order, raises the revision and returns the board", async () => {
    await insert();
    const response = await ops("tok", [
      { type: "move", player: 0, squad: 1 },
      { type: "leader", player: 0, lead: true },
      { type: "rename", squad: 1, name: "Alpha" },
      { type: "toggle", field: "showBench", value: false },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revision: number; state: Record<string, unknown> };
    expect(body.revision).toBe(4);
    expect(body.state).toMatchObject({
      assignments: { "0": 1 },
      squadLeaders: { "1": 0 },
      showBench: false,
    });
    expect(await board()).toMatchObject({ revision: 4, squadLeaders: { "1": 0 } });
    expect(((await board()).squadNames as string[])[0]).toBe("Alpha");
  });

  it("lets the later of two changes to the same player win", async () => {
    await insert();
    await ops("tok", [{ type: "move", player: 1, squad: 2 }], "page-1");
    await ops("tok", [{ type: "move", player: 1, squad: 3 }], "page-2");
    expect(await board()).toMatchObject({ assignments: { "1": 3 }, revision: 2 });
  });

  it("ignores changes to players and squads that don't exist", async () => {
    await insert();
    const response = await ops("tok", [
      { type: "move", player: 7, squad: 1 },
      { type: "move", player: 0, squad: 12 },
    ]);
    expect(response.status).toBe(200);
    expect(await board()).toMatchObject({ assignments: {}, revision: 2 });
  });

  it("adds and removes squads, sending their players back to the bench", async () => {
    await insert({ squadNames: names });
    await ops("tok", [
      { type: "addSquad", name: "Hotel" },
      { type: "move", player: 0, squad: 8 },
      { type: "move", player: 1, squad: 7 },
      { type: "removeSquad", squad: 7 },
    ]);
    const body = await board();
    expect(body.squadNames).toEqual([...names.slice(0, 6), "Hotel"]);
    expect(body.assignments).toEqual({ "0": 7 });
  });

  it("refuses malformed changes, and applies none of a batch with one", async () => {
    await insert();
    expect((await ops("tok", [{ type: "rename", squad: 1, name: "" }])).status).toBe(400);
    expect((await ops("tok", [{ type: "explode" }])).status).toBe(400);
    expect(
      (
        await ops("tok", [
          { type: "move", player: 0, squad: 1 },
          { type: "style", field: "colour", value: "red" },
        ])
      ).status,
    ).toBe(400);
    expect(await board()).toMatchObject({ assignments: {}, revision: 0 });
  });

  it("saves the embed style one field at a time, and keeps it in the server's default", async () => {
    await insert();
    await ops("tok", [
      { type: "style", field: "title", value: "Raid" },
      { type: "style", field: "colour", value: "#00cdde" },
      { type: "style", field: "leaderEmoji", value: { name: "👑" } },
    ]);
    const embedStyle = { title: "Raid", colour: "#00cdde", leaderEmoji: { name: "👑" } };
    expect((await put("tok/default-squad-names", { squadNames: names, embedStyle })).status).toBe(
      200,
    );
    expect(await board()).toMatchObject({ embedStyle, defaultEmbedStyle: embedStyle });
    await ops("tok", [{ type: "style", field: "title", value: null }]);
    expect((await board()).embedStyle).toEqual({ colour: "#00cdde", leaderEmoji: { name: "👑" } });
  });

  it("refuses server emoji the bot didn't list, in styles, squads and answers", async () => {
    await insert();
    const wolf = { id: "123456789012345678", name: "wolf" };
    expect((await ops("tok", [{ type: "style", field: "leaderEmoji", value: wolf }])).status).toBe(
      400,
    );
    expect((await ops("tok", [{ type: "squadEmoji", squad: 1, emoji: wolf }])).status).toBe(400);
    const answers = [{ key: "confirmed", label: "In", emoji: wolf }];
    expect((await ops("tok", [{ type: "answers", options: answers }])).status).toBe(400);

    await database.db.update(schema.rosterInstances).set({
      emojiOptions: { loadedAt: new Date().toISOString(), emojis: [wolf] },
    });
    expect((await ops("tok", [{ type: "answers", options: answers }])).status).toBe(200);
    expect((await board()).answerOptions).toEqual(answers);
  });

  it("refuses answer buttons whose first isn't Confirm", async () => {
    await insert();
    const options = [{ key: "late", label: "Late" }];
    expect((await ops("tok", [{ type: "answers", options }])).status).toBe(400);
  });

  it("saves the server's default names, for this roster's server only", async () => {
    await insert();
    await insert({ token: "other", guildId: "2" });
    expect((await put("tok/default-squad-names", { squadNames: names })).status).toBe(200);
    const again = names.map((name) => `${name}2`);
    expect((await put("tok/default-squad-names", { squadNames: again })).status).toBe(200);

    const mine = (await (await app.request("/api/roster/tok")).json()) as {
      defaultSquadNames: string[];
      squadNames: string[];
    };
    expect(mine.defaultSquadNames).toEqual(again);
    expect(mine.squadNames).not.toEqual(again);
    const other = (await (await app.request("/api/roster/other")).json()) as {
      defaultSquadNames: string[];
    };
    expect(other.defaultSquadNames[0]).toBe("CERBERUS");
  });

  it("won't save default names through an unknown link", async () => {
    expect((await put("nope/default-squad-names", { squadNames: names })).status).toBe(404);
  });

  it("refuses changes once posted, and to unknown links", async () => {
    await insert({ status: "posted" });
    expect((await ops("tok", [{ type: "move", player: 0, squad: 1 }])).status).toBe(409);
    expect((await ops("nope", [{ type: "move", player: 0, squad: 1 }])).status).toBe(404);
  });

  it("returns the event for a valid token", async () => {
    await insert();
    const response = await app.request("/api/roster/tok");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ event: { title: "Scrim" }, status: "draft" });
  });

  it("hides unknown and expired rosters alike", async () => {
    await insert({ expiresAt: new Date(Date.now() - 1000) });
    expect((await app.request("/api/roster/tok")).status).toBe(404);
    expect((await app.request("/api/roster/other")).status).toBe(404);
  });

  it("queues a preview redraw for each saved change, and none for a refused one", async () => {
    await insert();
    await ops("tok", [{ type: "move", player: 0, squad: 1 }]);
    expect(await jobs()).toHaveLength(1);
    expect((await jobs())[0]).toMatchObject({
      type: "roster.preview",
      payload: { id: expect.any(String) },
    });
    await ops("tok", [{ type: "rename", squad: 1, name: "" }]);
    expect(await jobs()).toHaveLength(1);
  });

  it("only asks the bot for emoji when it has none or they're old", async () => {
    await insert();
    expect(await (await app.request("/api/roster/tok/emojis")).json()).toEqual({ cache: null });
    await app.request("/api/roster/tok/emojis", { method: "POST" });
    expect(await database.db.select().from(schema.botJobs)).toHaveLength(1);

    const fresh = { loadedAt: new Date().toISOString(), emojis: [] };
    await database.db.update(schema.rosterInstances).set({ emojiOptions: fresh });
    await app.request("/api/roster/tok/emojis", { method: "POST" });
    expect(await database.db.select().from(schema.botJobs)).toHaveLength(1);

    const old = { loadedAt: new Date(Date.now() - 3_600_000).toISOString(), emojis: [] };
    await database.db.update(schema.rosterInstances).set({ emojiOptions: old });
    await app.request("/api/roster/tok/emojis", { method: "POST" });
    expect(await database.db.select().from(schema.botJobs)).toHaveLength(2);
  });
});

/** Reads a roster's event stream, one event at a time. */
async function openStream(token: string, clientId: string, name = "Tester") {
  const response = await app.request(
    `/api/roster/${token}/events?clientId=${clientId}&name=${encodeURIComponent(name)}`,
  );
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  async function next(): Promise<{ type: string; [key: string]: unknown }> {
    for (;;) {
      const end = buffered.indexOf("\n\n");
      if (end >= 0) {
        const block = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const data = block.split("\n").find((line) => line.startsWith("data: "));
        if (data) return JSON.parse(data.slice(6)) as { type: string };
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`stream ended after: ${JSON.stringify(buffered)}`);
      buffered += value;
    }
  }
  /** The next event of a type, skipping others such as presence. */
  async function nextOf(type: string) {
    for (;;) {
      const event = await next();
      if (event.type === type) return event;
    }
  }
  return { response, next, nextOf, close: () => reader.cancel() };
}

describe("roster events", () => {
  it("refuses a stream without a valid client, or for an unknown or posted roster", async () => {
    await insert();
    expect((await app.request("/api/roster/tok/events")).status).toBe(400);
    expect((await app.request("/api/roster/nope/events?clientId=a")).status).toBe(404);
    await database.db.update(schema.rosterInstances).set({ status: "posted" });
    expect((await app.request("/api/roster/tok/events?clientId=a")).status).toBe(409);
  });

  it("says where the board is, then passes on everyone's changes in order", async () => {
    await insert();
    const stream = await openStream("tok", "watcher");
    expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.response.headers.get("cache-control")).toContain("no-transform");
    expect(await stream.nextOf("hello")).toMatchObject({ revision: 0 });

    await ops("tok", [{ type: "move", player: 0, squad: 2 }], "page-1");
    await ops("tok", [{ type: "move", player: 1, squad: 3 }], "page-2");
    expect(await stream.nextOf("op")).toMatchObject({
      revision: 1,
      clientId: "page-1",
      op: { type: "move", player: 0, squad: 2 },
    });
    expect(await stream.nextOf("op")).toMatchObject({ revision: 2, clientId: "page-2" });
    await stream.close();
  });

  it("shows who is on the page and which player they are dragging", async () => {
    await insert();
    const first = await openStream("tok", "one", "Ana");
    expect(await first.nextOf("presence")).toMatchObject({
      editors: [{ clientId: "one", name: "Ana", dragging: null }],
    });
    const second = await openStream("tok", "two", "Bo");
    expect(((await first.nextOf("presence")).editors as unknown[]).length).toBe(2);

    const presence = await app.request("/api/roster/tok/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "two", dragging: 1 }),
    });
    expect(presence.status).toBe(204);
    expect((await first.nextOf("presence")).editors).toContainEqual({
      clientId: "two",
      name: "Bo",
      dragging: 1,
    });
    await second.close();
    await first.close();
  });

  it("closes the stream when the bot says the roster was posted, and reloads after a discard", async () => {
    await insert();
    const [row] = await database.db.select().from(schema.rosterInstances);
    const stream = await openStream("tok", "watcher");
    await stream.nextOf("hello");

    // The bot notifies after Discard, and the board must be loaded again.
    await database.sql`select pg_notify('roster_changed', ${row!.id})`;
    expect(await stream.nextOf("reset")).toMatchObject({ revision: 0 });

    await database.db.update(schema.rosterInstances).set({ status: "posted" });
    await database.sql`select pg_notify('roster_changed', ${row!.id})`;
    expect(await stream.nextOf("closed")).toEqual({ type: "closed" });
    await stream.close();
  });
});
