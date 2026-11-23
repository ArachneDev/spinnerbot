/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn } from "node:child_process";
import { crc32, deflateSync } from "node:zlib";
import {
  Client,
  type GuildMember,
  MessageFlags,
  MessageFlagsBitField,
  REST,
  Routes,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { DEFAULT_SQUAD_NAMES } from "@scrimbot/core";
import { createDatabase, schema } from "@scrimbot/db";
import { devRoleUrl } from "./dev-roles.js";
import { devGuildId, standIns, testerCreds } from "./tester.js";
import { features } from "../src/features/index.js";
import { forgetPingCooldown } from "../src/features/build-roster/ping.js";
import { loadConfig } from "../src/framework/config.js";
import { readAsset } from "../src/framework/assets.js";
import { BANNER_FILE, CREST_FILE } from "../src/framework/brand.js";
import { attachListeners } from "../src/framework/events.js";
import { createJobWorker } from "../src/framework/job-worker.js";
import { createLogger } from "../src/framework/logger.js";
import { createPythonBridge } from "../src/framework/python.js";
import { buildRegistry } from "../src/framework/registry.js";
import { routeInteraction } from "../src/framework/router.js";
import type { FeatureContext } from "../src/framework/types.js";

// Dev tool: runs the roster flow end to end against the real test server.
//
// What is real: the bot logs in to Discord, the real command and button code runs, the roster
// message is really posted, edited and deleted in a new test channel, and TesterBot reads the
// public result back through the API. The web API and the job worker run too.
// What is simulated: Discord only lets human accounts run commands and press buttons, so each
// press is a stand-in interaction, sent from a user ID I choose. Anything private to the person
// (previews, prompts, error notices) is captured here instead of being shown in Discord.
//
// Needs the dev database with its roles set up (`pnpm dev` does that, or `pnpm db:dev-roles`).
// Usage: pnpm --filter @scrimbot/bot e2e

const GUILD = devGuildId();
const creds = testerCreds();
const tester = new REST().setToken(creds.token);

// People in the test server, picked after login. The owner is a human if the server has one, and
// the rest are bots where possible, so nobody real is pinged. Each name comes from Discord.
// Order matters for ACCEPTED: it is the accepted-player index the web page uses.
let USERS = {
  owner: "",
  playerA: "",
  playerB: "",
  playerC: "",
  playerD: "",
  stranger: "999999999999999999", // not in the server
};
let ACCEPTED: string[] = [];
let NAMES = { playerC: "" };

// ---- tiny test runner -------------------------------------------------------------------------

let failures = 0;
async function step(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}\n        ${error instanceof Error ? error.message : String(error)}`);
  }
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const equal = (actual: unknown, wanted: unknown, what: string) =>
  expect(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${what}: wanted ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`,
  );
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Whether the bot has deleted the private message this press answered. */
const deleted = (fake: { calls: { method: string }[] }) =>
  fake.calls.some((c) => c.method === "deleteReply");
async function until<T>(what: string, check: () => Promise<T | undefined | false>, ms = 12_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(300);
  }
}

// ---- the real bot, wired as main.ts does it ---------------------------------------------------

const config = loadConfig();
const log = createLogger("warn");
const registry = buildRegistry(features);
// As in production, the bot and the web server each connect as their own restricted role.
const database = createDatabase(devRoleUrl(config.databaseUrl, "scrimbot_bot"));
const client = new Client({ intents: registry.intents });
const context: FeatureContext = {
  client,
  database,
  log,
  python: createPythonBridge({ log, pythonBin: config.pythonBin }),
  publicUrl: config.publicUrl,
};

// Private edits go to Discord's interaction webhooks, which only a real token can reach. Capture
// them. Public message edits are counted, to check that bursts are merged.
const previews: { token: string; at: number; body: any }[] = [];
let publicEdits = 0;
const realPatch = client.rest.patch.bind(client.rest);
(client.rest as any).patch = async (route: string, options: any) => {
  if (route.startsWith("/webhooks/")) {
    previews.push({ token: route.split("/")[3]!, at: Date.now(), body: options?.body });
    return {};
  }
  if (/^\/channels\/\d+\/messages\/\d+$/.test(route)) publicEdits++;
  return realPatch(route as `/${string}`, options);
};

const { rosterInstances: instances, rosterResponses: responses } = schema;
// The real web server, as its own process on a spare port.
const WEB_PORT = 3917;
const webBase = `http://127.0.0.1:${WEB_PORT}`;
const webProcess = spawn(
  "pnpm",
  ["--filter", "@scrimbot/web", "exec", "tsx", "--env-file=../../.env", "server/main.ts"],
  {
    env: {
      ...process.env,
      PORT: String(WEB_PORT),
      LOG_LEVEL: "warn",
      DATABASE_URL: devRoleUrl(config.databaseUrl, "scrimbot_web"),
    },
    stdio: "ignore",
  },
);
const web = { request: (path: string, init?: RequestInit) => fetch(webBase + path, init) };
const worker = createJobWorker(registry, context);

// ---- stand-in interactions --------------------------------------------------------------------

interface Fake {
  user: string;
  calls: { method: string; payload: any }[];
  /** What the person would see in their private message, after JSON conversion. */
  shown(): any;
  all(): any[];
}

let tokenCounter = 0;
async function makeBase(user: string, channelId: string) {
  const guild = await client.guilds.fetch(GUILD);
  const channel = await client.channels.fetch(channelId);
  const calls: Fake["calls"] = [];
  const record = (method: string) => async (payload?: any) => {
    calls.push({
      method,
      payload: payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)),
    });
  };
  const base: any = {
    client,
    guild,
    guildId: GUILD,
    channel,
    channelId,
    user: { id: user, bot: false },
    token: `fake-token-${++tokenCounter}`,
    deferred: false,
    replied: false,
    memberPermissions: { has: () => true },
    appPermissions: (channel as any).permissionsFor(client.user!),
    isModalSubmit: () => false,
    deferReply: async (p?: any) => {
      base.deferred = true;
      await record("deferReply")(p);
    },
    deferUpdate: async () => {
      base.deferred = true;
      await record("deferUpdate")();
    },
    reply: async (p: any) => {
      base.replied = true;
      await record("reply")(p);
    },
    editReply: record("editReply"),
    followUp: record("followUp"),
    deleteReply: record("deleteReply"),
    update: async (p: any) => {
      base.replied = true;
      await record("update")(p);
    },
  };
  const fake: Fake = {
    user,
    calls,
    shown: () =>
      [...calls]
        .reverse()
        .find((c) => ["reply", "editReply", "update", "followUp"].includes(c.method))?.payload,
    all: () => calls.map((c) => c.payload),
  };
  return { base, fake };
}

/** A person running /build-roster. */
async function runCommand(user: string, channelId: string, event: string): Promise<Fake> {
  const { base, fake } = await makeBase(user, channelId);
  Object.assign(base, {
    commandName: "build-roster",
    isChatInputCommand: () => true,
    isMessageComponent: () => false,
    options: { get: (name: string) => (name === "event" ? { name, type: 3, value: event } : null) },
  });
  await routeInteraction(base, registry, context);
  return fake;
}

/** A person pressing a button, found by the id it has on the message they are looking at. */
async function click(
  user: string,
  channelId: string,
  customId: string,
  messageId: string,
  content = "",
): Promise<Fake> {
  const { base, fake } = await makeBase(user, channelId);
  Object.assign(base, {
    customId,
    // Private replies are ephemeral, which decides whether a button updates or replies.
    message: {
      id: messageId,
      content,
      flags: new MessageFlagsBitField(messageId.startsWith("private") ? MessageFlags.Ephemeral : 0),
    },
    isChatInputCommand: () => false,
    isMessageComponent: () => true,
  });
  await routeInteraction(base, registry, context);
  return fake;
}

/** Finds a button by its label in a private message, as a person would. */
function buttonIn(payload: any, label: string): string {
  for (const row of payload?.components ?? []) {
    for (const component of row.components)
      if (component.label === label) return component.custom_id;
  }
  throw new Error(`No "${label}" button. Buttons shown: ${labelsIn(payload).join(", ") || "none"}`);
}
const labelsIn = (payload: any): string[] =>
  (payload?.components ?? []).flatMap((row: any) => row.components.map((c: any) => c.label));

// ---- reading Discord back, as TesterBot -------------------------------------------------------

async function publicMessage(channelId: string, messageId: string): Promise<any> {
  return tester.get(Routes.channelMessage(channelId, messageId));
}
function describe(message: any) {
  const embed = message.embeds?.[0] ?? {};
  return {
    title: embed.title as string,
    description: (embed.description ?? "") as string,
    fields: Object.fromEntries(
      (embed.fields ?? []).map((f: any) => [squadOf(f.name), f.value as string]),
    ),
    rows: (message.components ?? []).map((r: any) => r.components) as any[][],
    reactions: (message.reactions ?? []).length as number,
  };
}
const publicButton = (message: any, label: string): string => {
  for (const row of describe(message).rows)
    for (const c of row) if (c.label === label) return c.custom_id;
  throw new Error(`No "${label}" button on the public message`);
};

// ---- web page requests ------------------------------------------------------------------------

const json = (body: unknown, method = "PUT") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const webGet = async (path: string) => web.request(`/api/roster/${path}`);
let opCounter = 0;
/** Sends changes the way the roster page does, 20 to a request as it does. */
async function webOps(token: string, ops: object[], clientId = "e2e-page"): Promise<Response> {
  let response: Response | undefined;
  for (let i = 0; i < ops.length; i += 20) {
    const batch = ops.slice(i, i + 20).map((op) => ({ id: `e2e${++opCounter}`, op }));
    response = await web.request(
      `/api/roster/${token}/ops`,
      json({ clientId, ops: batch }, "POST"),
    );
    if (!response.ok) return response;
  }
  return response!;
}
/**
 * Saves a board the way the page would: as the changes that turn the current board into this
 * one. Fields left out stay as they are. Server defaults are still a plain PUT.
 */
async function webPut(path: string, body: any): Promise<Response> {
  const [token = "", sub] = path.split("/");
  if (sub === "answers") return webOps(token, [{ type: "answers", options: body.answerOptions }]);
  if (sub) return web.request(`/api/roster/${path}`, json(body));
  const ops: object[] = [];
  if (body.squadNames) {
    const current = await webGet(token);
    if (!current.ok) return current;
    const have = ((await current.json()) as { squadNames: string[] }).squadNames.length;
    const want = body.squadNames as string[];
    for (let n = have; n < want.length; n++) ops.push({ type: "addSquad", name: want[n] });
    for (let n = have; n > want.length; n--) ops.push({ type: "removeSquad", squad: n });
    want.forEach((name, i) => ops.push({ type: "rename", squad: i + 1, name }));
  }
  if (body.assignments) {
    ACCEPTED.forEach((_, player) =>
      ops.push({ type: "move", player, squad: body.assignments[String(player)] ?? 0 }),
    );
  }
  for (const player of Object.values((body.squadLeaders ?? {}) as Record<string, number>)) {
    ops.push({ type: "leader", player, lead: true });
  }
  for (const field of ["showBanner", "showBench"]) {
    if (body[field] !== undefined) ops.push({ type: "toggle", field, value: body[field] });
  }
  for (const [field, value] of Object.entries((body.embedStyle ?? {}) as Record<string, unknown>)) {
    ops.push({ type: "style", field, value });
  }
  return webOps(token, ops);
}

/** A roster page's live stream, read event by event, as a browser's EventSource would. */
async function openEvents(token: string, clientId: string, name: string) {
  const controller = new AbortController();
  const response = await web.request(
    `/api/roster/${token}/events?clientId=${clientId}&name=${encodeURIComponent(name)}`,
    { signal: controller.signal },
  );
  if (!response.ok) throw new Error(`events: ${response.status}`);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  async function next(ms: number): Promise<any> {
    const deadline = Date.now() + ms;
    for (;;) {
      const end = buffered.indexOf("\n\n");
      if (end >= 0) {
        const block = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const data = block.split("\n").find((line) => line.startsWith("data: "));
        if (data) return JSON.parse(data.slice(6));
        continue;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("no event in time");
      const read = await Promise.race([
        reader.read(),
        sleep(left).then(() => ({ timeout: true }) as const),
      ]);
      if ("timeout" in read) throw new Error("no event in time");
      if (read.done) return { type: "ended" };
      buffered += read.value;
    }
  }
  /** The next event of a type within `ms`, skipping the others. */
  async function nextOf(type: string, ms = 1000, test: (event: any) => boolean = () => true) {
    const deadline = Date.now() + ms;
    for (;;) {
      const event = await next(Math.max(1, deadline - Date.now()));
      if (event.type === type && test(event)) return event;
      if (event.type === "ended") throw new Error(`stream ended waiting for ${type}`);
    }
  }
  return { response, nextOf, close: () => controller.abort() };
}

// ---- setup in Discord -------------------------------------------------------------------------

function makePng(size: number): string {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 4, 0)]);
  for (let x = 0; x < size; x++) row.set([0x2e, 0xcc, 0x71, 0xff], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

/** The squad in a field name, without its type and count. */
const squadOf = (name: string) => name.split(" · ")[0]!;

function apolloEmbed(title: string, accepted: string[], declined: string[], tag: string) {
  const names = (list: string[]) => (list.length ? `>>> ${list.join("\n")}` : "-");
  const when = Math.floor(Date.now() / 1000) + 86_400;
  return {
    title,
    description: "Friendly Match\nThis is an automated test event.",
    fields: [
      { name: "Time", value: `<t:${when}:F>\n <t:${when}:R>`, inline: false },
      {
        name: `${tag} Accepted` + (accepted.length ? ` (${accepted.length})` : ""),
        value: names(accepted),
        inline: true,
      },
      {
        name: `${tag} Declined` + (declined.length ? ` (${declined.length})` : ""),
        value: names(declined),
        inline: true,
      },
      { name: `${tag} Tentative`, value: "-", inline: true },
    ],
  };
}

const rowFor = async (id: string) =>
  (await database.db.select().from(instances).where(eq(instances.id, id)))[0];
const newestRow = async () =>
  (await database.db.select().from(instances)).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]!;
const tokenOf = (content: string) => /\/r\/([\w-]+)/.exec(content)?.[1] ?? "";

// ---- the run ----------------------------------------------------------------------------------

await client.login(config.discordToken);
await new Promise<void>((resolve) => client.once("clientReady", () => resolve()));
{
  const { humans, bots } = await standIns(await client.guilds.fetch(GUILD), [
    client.user!.id,
    creds.appId,
  ]);
  const people = [humans[0] ?? bots.shift(), ...bots, ...humans.slice(1)].filter(
    (member) => member !== undefined,
  );
  if (people.length < 5) {
    console.error(
      `The test server needs 5 members besides the dev app and TesterBot, each with a name no ` +
        `one else has (a human for the owner, and bots for the rest if possible). It has ${people.length}.`,
    );
    process.exit(2);
  }
  const [owner, a, b, c, d] = people as [
    GuildMember,
    GuildMember,
    GuildMember,
    GuildMember,
    GuildMember,
  ];
  USERS = { ...USERS, owner: owner.id, playerA: a.id, playerB: b.id, playerC: c.id, playerD: d.id };
  ACCEPTED = [owner, a, b, c, d].map((m) => m.displayName).concat("Non-discord-user");
  NAMES = { playerC: c.displayName };
}
attachListeners(client, registry, context);
await worker.start();
await until("web server", async () => (await web.request("/healthz").catch(() => undefined))?.ok);

const created: { category?: string; channel?: string; emoji?: string } = {};
try {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const category: any = await tester.post(Routes.guildChannels(GUILD), {
    body: { name: `spinnerbot-e2e-${stamp}`, type: 4 },
  });
  created.category = category.id;
  const channel: any = await tester.post(Routes.guildChannels(GUILD), {
    body: {
      name: `spinnerbot-e2e-${stamp}`,
      type: 0,
      parent_id: category.id,
      topic: "Automated test run",
    },
  });
  created.channel = channel.id;
  const emoji: any = await tester.post(Routes.guildEmojis(GUILD), {
    body: { name: "e2e_ok", image: `data:image/png;base64,${makePng(32)}` },
  });
  created.emoji = emoji.id;
  console.log(`Test channel #${channel.name} (${channel.id}), test emoji :e2e_ok: (${emoji.id})\n`);

  const post = async (embed: unknown) =>
    (await tester.post(Routes.channelMessages(channel.id), { body: { embeds: [embed] } })) as any;
  const apollo = await post(
    apolloEmbed("E2E Scrim", ACCEPTED, ["Apollo"], `<:e2e_ok:${emoji.id}>`),
  );
  const notApollo = (await tester.post(Routes.channelMessages(channel.id), {
    body: { content: "just a message" },
  })) as any;
  const link = (id: string, guild = GUILD) =>
    `https://discord.com/channels/${guild}/${channel.id}/${id}`;

  // ----- 1. bad input is turned away politely
  await step("rejects text that isn't a message link or ID", async () => {
    const out = await runCommand(USERS.owner, channel.id, "hello there");
    expect(
      String(out.shown()?.content).includes("message link or message ID"),
      `got ${JSON.stringify(out.shown())}`,
    );
  });
  await step("rejects a message that isn't an Apollo event", async () => {
    const out = await runCommand(USERS.owner, channel.id, link(notApollo.id));
    expect(
      String(out.shown()?.content).includes("not an Apollo event"),
      `got ${JSON.stringify(out.shown())}`,
    );
  });
  await step("rejects an event link from another server", async () => {
    const out = await runCommand(USERS.owner, channel.id, link(apollo.id, "1000000000000000001"));
    expect(
      String(out.shown()?.content).includes("different server"),
      `got ${JSON.stringify(out.shown())}`,
    );
  });

  // ----- 2. starting a roster
  let start!: Fake;
  await step("/build-roster shows what it understood from the Apollo event", async () => {
    start = await runCommand(USERS.owner, channel.id, link(apollo.id));
    const embed = start.shown().embeds[0];
    equal(embed.title, "E2E Scrim", "title");
    const names = embed.fields.map((f: any) => f.name);
    equal(names, ["Accepted · 6", "Declined · 1", "Tentative · 0"], "field names");
    equal(labelsIn(start.shown()), ["Continue", "Cancel"], "buttons");
  });

  await step("running it again picks up people who signed up since", async () => {
    const later = await post(apolloEmbed("E2E Later", ["First"], [], `<:e2e_ok:${emoji.id}>`));
    const before = await runCommand(USERS.owner, channel.id, link(later.id));
    equal(before.shown().embeds[0].fields[0].name, "Accepted · 1", "first read");
    await tester.patch(Routes.channelMessage(channel.id, later.id), {
      body: {
        embeds: [apolloEmbed("E2E Later", ["First", "Second"], [], `<:e2e_ok:${emoji.id}>`)],
      },
    });
    const after = await runCommand(USERS.owner, channel.id, link(later.id));
    equal(after.shown().embeds[0].fields[0].name, "Accepted · 2", "second read");
  });

  await step("Cancel on the first step creates nothing", async () => {
    const before = (await database.db.select().from(instances)).length;
    const out = await click(
      USERS.owner,
      channel.id,
      buttonIn(start.shown(), "Cancel"),
      "private-1",
    );
    expect(
      String(out.shown()?.content).includes("cancelled"),
      `got ${JSON.stringify(out.shown())}`,
    );
    await sleep(50);
    expect(deleted(out), "the cancelled message is removed at once");
    equal((await database.db.select().from(instances)).length, before, "rows");
  });

  let draft!: Fake;
  let rosterId = "";
  let token = "";
  await step("Continue creates the roster and a private link", async () => {
    start = await runCommand(USERS.owner, channel.id, link(apollo.id));
    draft = await click(USERS.owner, channel.id, buttonIn(start.shown(), "Continue"), "private-2");
    const row = await newestRow();
    rosterId = row.id;
    const shown = draft.shown();
    token = tokenOf(shown.content);
    expect(token === row.token, "the private link carries the roster's token");
    expect(shown.content.includes(`${config.publicUrl}/r/`), "link starts with PUBLIC_URL");
    expect(shown.content.includes("[Open the roster builder]("), "the link is a text link");
    expect(
      shown.content.includes("5 of 6 players matched"),
      `matching line: ${shown.content.split("\n").pop()}`,
    );
    equal(
      labelsIn(shown),
      ["Confirm", "Can’t make it", "Post roster", "Refresh preview", "Cancel"],
      "the answers as they will look, then the buttons",
    );
    equal(shown.embeds[0].title, "E2E Scrim", "preview title");
    equal(row.status, "draft", "status");
    expect(Boolean(row.previewToken), "preview token held");
  });

  // ----- 3. the web page
  await step("web page loads the event, with the Confirm answer first", async () => {
    const response = await webGet(token);
    equal(response.status, 200, "status");
    const body: any = await response.json();
    equal(
      body.event.responses.accepted.map((p: any) => p.displayName),
      ACCEPTED,
      "players",
    );
    equal(body.answerOptions[0].key, "confirmed", "first answer");
    equal((await webGet("no-such-token")).status, 404, "unknown token");
  });

  await step("saving squads updates the private live preview", async () => {
    const mark = previews.length;
    const saved = await webPut(token, { assignments: { "0": 1, "1": 1, "2": 2, "3": 2, "5": 3 } });
    equal(saved.status, 200, "save status");
    const update = await until("preview edit", async () =>
      previews.slice(mark).find((p) => p.body?.embeds?.length),
    );
    const fields = update.body.embeds[0].fields.map((f: any) => squadOf(f.name));
    equal(fields, ["CERBERUS", "BLACKSPEAR", "DIREHOUND", "Bench"], "preview squads");
    equal(update.token, (await rowFor(rosterId))!.previewToken, "edited the leader's own message");
  });

  await step("a burst of 12 saves becomes at most 3 Discord edits and ends correct", async () => {
    await sleep(2500);
    const mark = previews.length;
    for (let i = 0; i < 12; i++) {
      const squad = (i % 2) + 1;
      await webPut(token, { assignments: { "0": squad, "1": 1, "2": 2, "3": 2, "5": 3 } });
    }
    await sleep(5000);
    const edits = previews.slice(mark);
    expect(edits.length >= 1 && edits.length <= 3, `${edits.length} edits for 12 saves`);
    const last = edits
      .at(-1)!
      .body.embeds[0].fields.find((f: any) => squadOf(f.name) === "CERBERUS").value as string;
    expect(last.includes("<@" + USERS.playerA + ">"), "final preview reflects the final save");
    await webPut(token, { assignments: { "0": 1, "1": 1, "2": 2, "3": 2, "5": 3 } });
    await sleep(2500);
  });

  // ----- 3b. several people on one link
  await step("two pages on one link see each other's changes within a second", async () => {
    const ana = await openEvents(token, "e2e-ana", "Ana");
    const bo = await openEvents(token, "e2e-bo", "Bo");
    equal(
      bo.response.headers.get("cache-control"),
      "no-cache, no-transform",
      "the stream isn't cached or compressed",
    );
    const { revision } = await bo.nextOf("hello");
    await bo.nextOf("presence", 1000, (e) => e.editors.length === 2);

    const sent = Date.now();
    equal(
      (await webOps(token, [{ type: "move", player: 3, squad: 1 }], "e2e-ana")).status,
      200,
      "Ana's change",
    );
    const event = await bo.nextOf("op");
    expect(Date.now() - sent < 1000, `arrived after ${Date.now() - sent} ms`);
    equal(event.revision, revision + 1, "the next revision");
    equal(event.clientId, "e2e-ana", "marked as Ana's");
    equal(event.op, { type: "move", player: 3, squad: 1 }, "the change itself");

    const drag = await web.request(
      `/api/roster/${token}/presence`,
      json({ clientId: "e2e-ana", dragging: 3 }, "POST"),
    );
    equal(drag.status, 204, "drag reported");
    await bo.nextOf("presence", 1000, (e) =>
      e.editors.some((x: any) => x.name === "Ana" && x.dragging === 3),
    );

    // A page that closes leaves the list, which only a real connection can show.
    ana.close();
    await bo.nextOf("presence", 2000, (e) => e.editors.every((x: any) => x.name !== "Ana"));
    bo.close();
    await webOps(token, [{ type: "move", player: 3, squad: 2 }]);
  });

  // ----- 4. customising the answer buttons
  await step("rejects bad answer buttons", async () => {
    const ok = { key: "confirmed", label: "I'm in" };
    equal(
      (await webPut(`${token}/answers`, { answerOptions: [{ key: "late", label: "Late" }] }))
        .status,
      400,
      "first isn't Confirm",
    );
    const six = [ok, ...[1, 2, 3, 4, 5].map((n) => ({ key: `k${n}`, label: "x" }))];
    equal((await webPut(`${token}/answers`, { answerOptions: six })).status, 400, "six buttons");
    const unknown = [{ ...ok, emoji: { id: "123456789012345678", name: "nope" } }];
    equal(
      (await webPut(`${token}/answers`, { answerOptions: unknown })).status,
      400,
      "server emoji the bot never listed",
    );
    equal(
      (await webPut(`${token}/answers`, { answerOptions: [{ ...ok, emoji: { name: "hello" } }] }))
        .status,
      400,
      "text as icon",
    );
  });

  await step("opening the editor makes the bot list the server's emoji", async () => {
    equal(
      ((await (await webGet(`${token}/emojis`)).json()) as any).cache,
      null,
      "nothing loaded yet",
    );
    equal(
      (await web.request(`/api/roster/${token}/emojis`, { method: "POST" })).status,
      202,
      "request accepted",
    );
    const cache: any = await until(
      "emoji list",
      async () => ((await (await webGet(`${token}/emojis`)).json()) as any).cache,
    );
    expect(
      cache.emojis.some((e: any) => e.id === emoji.id),
      "the test emoji is in the list",
    );
  });

  const labels = ["I'm in", "Late", "Backup"];
  await step("custom answer buttons save and show in the preview", async () => {
    const mark = previews.length;
    const options = [
      { key: "confirmed", label: labels[0], emoji: { name: "✅" } },
      { key: "late", label: labels[1], emoji: { name: "🕐" } },
      { key: "backup", label: labels[2], emoji: { id: emoji.id, name: "e2e_ok" } },
    ];
    equal((await webPut(`${token}/answers`, { answerOptions: options })).status, 200, "save");
    const update = await until("preview edit", async () =>
      previews.slice(mark).find((p) => p.body?.content),
    );
    const shownLabels = labelsIn(update.body);
    expect(
      shownLabels.includes("I'm in") && shownLabels.includes("Backup"),
      `buttons: ${shownLabels.join(", ")}`,
    );
  });

  // ----- 5. posting
  let messageId = "";
  let watcher!: Awaited<ReturnType<typeof openEvents>>;
  await step("Post roster publishes the roster with the custom buttons", async () => {
    // Someone still on the page when the roster is posted.
    watcher = await openEvents(token, "e2e-watcher", "Watcher");
    await watcher.nextOf("hello");
    const out = await click(
      USERS.owner,
      channel.id,
      buttonIn(draft.shown(), "Post roster"),
      "private-2",
    );
    expect(
      String(out.shown()?.content).includes("Roster posted"),
      `private: ${JSON.stringify(out.shown())}`,
    );
    expect(!deleted(out), "the result stays for a moment");
    await sleep(5500);
    expect(deleted(out), "then the result is removed");
    const row = (await rowFor(rosterId))!;
    messageId = row.postedMessageId!;
    equal(row.status, "posted", "status");
    const view = describe(await publicMessage(channel.id, messageId));
    equal(view.title, "E2E Scrim", "title");
    expect(view.description.includes("Confirmed 0/5"), `description: ${view.description}`);
    equal(
      view.rows[0]!.map((c) => c.label),
      labels,
      "answer buttons",
    );
    equal(
      view.rows[1]!.map((c) => c.label),
      ["Manage"],
      "management button",
    );
    equal(view.rows[0]![2]?.emoji?.id, emoji.id, "server emoji on the third button");
    equal(view.reactions, 0, "no reactions");
    expect(view.fields["CERBERUS"]?.includes("⏳"), "everyone starts as waiting");
  });

  await step("posting ends the streams of anyone still on the page", async () => {
    await watcher.nextOf("closed", 3000);
    watcher.close();
    equal(
      (await web.request(`/api/roster/${token}/events?clientId=late`)).status,
      409,
      "no new stream on a posted roster",
    );
  });

  await step("pressing Post again doesn't post twice", async () => {
    const out = await click(
      USERS.owner,
      channel.id,
      buttonIn(draft.shown(), "Post roster"),
      "private-2",
    );
    expect(
      String(out.shown()?.content).includes("already been posted"),
      `got ${JSON.stringify(out.shown())}`,
    );
    const messages = (await tester.get(Routes.channelMessages(channel.id), {
      query: new URLSearchParams({ limit: "50" }),
    })) as any[];
    equal(messages.filter((m) => m.components?.length === 2).length, 1, "roster messages");
  });

  // ----- 6. players answering
  const answer = async (user: string, label: string) =>
    click(
      user,
      channel.id,
      publicButton(await publicMessage(channel.id, messageId), label),
      messageId,
    );
  /** The owner opens Manage, then presses a button in the private panel it shows. */
  const manage = async (user: string, label: string) => {
    const panel = await answer(user, "Manage");
    return click(user, channel.id, buttonIn(panel.shown(), label), "private-manage");
  };
  const waitFor = (what: string, test: (v: ReturnType<typeof describe>) => boolean) =>
    until(what, async () => {
      const view = describe(await publicMessage(channel.id, messageId));
      return test(view) ? view : false;
    });
  const answersOf = async () =>
    Object.fromEntries(
      (await database.db.select().from(responses).where(eq(responses.instanceId, rosterId))).map(
        (r) => [r.userId, r.answer],
      ),
    );

  await step("a listed player confirms, and the roster shows it", async () => {
    await answer(USERS.playerA, "I'm in");
    equal(await answersOf(), { [USERS.playerA]: "confirmed" }, "stored answers");
    const view = await waitFor("Confirmed 1/5", (v) => v.description.includes("Confirmed 1/5"));
    expect(
      view.fields["CERBERUS"].includes(`✅ <@${USERS.playerA}>`),
      `CERBERUS: ${view.fields["CERBERUS"]}`,
    );
  });

  await step("an extra answer shows but doesn't count as confirmed", async () => {
    await answer(USERS.owner, "Late");
    const view = await waitFor("Late 1", (v) => v.description.includes("Late: 1"));
    expect(view.description.includes("Confirmed 1/5"), `description: ${view.description}`);
    expect(
      view.fields["CERBERUS"].includes(`🕐 <@${USERS.owner}>`),
      `CERBERUS: ${view.fields["CERBERUS"]}`,
    );
  });

  await step("someone who isn't on the roster is turned away", async () => {
    const out = await answer(USERS.stranger, "I'm in");
    expect(
      String(out.shown()?.content).includes("not listed on this roster"),
      `got ${JSON.stringify(out.shown())}`,
    );
    expect(!(USERS.stranger in (await answersOf())), "nothing stored");
  });

  await step(
    "someone listed but unmatched can't answer, and an unplaced player is turned away",
    async () => {
      const out = await answer(USERS.playerD, "I'm in"); // playerD is on the bench
      expect(
        String(out.shown()?.content).includes("not listed on this roster"),
        `got ${JSON.stringify(out.shown())}`,
      );
    },
  );

  await step("pressing the same answer again asks before withdrawing", async () => {
    const before = publicEdits;
    const out = await answer(USERS.playerA, "I'm in");
    const prompt = out.shown();
    expect(
      String(prompt.content).includes("current answer is **I'm in**"),
      `got ${JSON.stringify(prompt)}`,
    );
    equal(labelsIn(prompt), ["Withdraw answer", "Keep answer"], "prompt buttons");
    equal((await answersOf())[USERS.playerA], "confirmed", "answer untouched");
    await sleep(3000);
    equal(publicEdits, before, "no public edit");
    const kept = await click(
      USERS.playerA,
      channel.id,
      buttonIn(prompt, "Keep answer"),
      "private-x",
    );
    expect(
      String(kept.shown()?.content).includes("No changes were made"),
      `got ${JSON.stringify(kept.shown())}`,
    );
    await sleep(50);
    expect(deleted(kept), "Keep removes the prompt at once");
    equal((await answersOf())[USERS.playerA], "confirmed", "still confirmed after Keep");
  });

  await step("withdrawing removes the answer and updates the roster", async () => {
    const prompt = (await answer(USERS.playerA, "I'm in")).shown();
    const done = await click(
      USERS.playerA,
      channel.id,
      buttonIn(prompt, "Withdraw answer"),
      "private-y",
    );
    expect(
      String(done.shown()?.content).includes("withdrawn"),
      `got ${JSON.stringify(done.shown())}`,
    );
    expect(!(USERS.playerA in (await answersOf())), "answer gone");
    await waitFor("Confirmed 0/5", (v) => v.description.includes("Confirmed 0/5"));
  });

  await step("changing answer replaces it, never adds a second", async () => {
    await answer(USERS.playerB, "I'm in");
    await answer(USERS.playerB, "Late");
    equal((await answersOf())[USERS.playerB], "late", "stored answer");
    const rows = (
      await database.db.select().from(responses).where(eq(responses.instanceId, rosterId))
    ).filter((r) => r.userId === USERS.playerB);
    equal(rows.length, 1, "rows for this player");
  });

  await step("buttons from the old Confirm/Can't make it version still work", async () => {
    const out = await click(
      USERS.playerC,
      channel.id,
      `build-roster:answer:${rosterId}:yes`,
      messageId,
    );
    expect(
      out.calls.some((c) => c.method === "deferUpdate"),
      `got ${JSON.stringify(out.all())}`,
    );
    equal((await answersOf())[USERS.playerC], "confirmed", "mapped to Confirm");
  });

  await step("a burst of answers from 4 players becomes few edits and ends correct", async () => {
    await sleep(2500);
    const before = publicEdits;
    const message = await publicMessage(channel.id, messageId);
    const ids = {
      in: publicButton(message, "I'm in"),
      late: publicButton(message, "Late"),
      backup: publicButton(message, "Backup"),
    };
    await Promise.all([
      click(USERS.playerA, channel.id, ids.in, messageId),
      click(USERS.playerB, channel.id, ids.in, messageId),
      click(USERS.owner, channel.id, ids.backup, messageId),
      click(USERS.playerC, channel.id, ids.late, messageId),
    ]);
    const view = await waitFor(
      "final counts",
      (v) =>
        v.description.includes("Confirmed 2/5") &&
        v.description.includes("Late: 1") &&
        v.description.includes("Backup: 1"),
    );
    await sleep(3000);
    expect(publicEdits - before <= 2, `${publicEdits - before} public edits for 4 presses`);
    expect(
      view.fields["CERBERUS"].includes("<:e2e_ok:"),
      `owner shows the server emoji: ${view.fields["CERBERUS"]}`,
    );
  });

  // ----- 6b. pinging players who haven't answered
  /** Who should be pinged, worked out here from the database rather than by the bot's code. */
  const expectedPending = async () => {
    const row = (await rowFor(rosterId))!;
    const given = await answersOf();
    const placed = Object.keys(row.postedAssignments as Record<string, number>).map(Number);
    const accepted = (row.snapshot as any).responses.accepted as { discordUserId?: string }[];
    return placed
      .map((index) => accepted[index]?.discordUserId)
      .filter((id): id is string => Boolean(id) && !given[id!]);
  };
  const threadMessages = async () =>
    ((await tester.get(Routes.channelMessages(messageId))) as any[]).filter(
      (m) => m.author?.id === client.user!.id && m.content?.startsWith("Roster check"),
    );
  const pingFromPanel = async () => {
    const ask = await manage(USERS.owner, "Ping pending");
    return {
      ask,
      done: await click(USERS.owner, channel.id, buttonIn(ask.shown(), "Ping"), "private-ping"),
    };
  };

  // Everyone matched has answered by now, so playerB's answer is set aside for these steps.
  const setAside = (
    await database.db
      .delete(responses)
      .where(and(eq(responses.instanceId, rosterId), eq(responses.userId, USERS.playerB)))
      .returning()
  )[0];

  await step(
    "Ping pending asks first, then pings only the pending players in a thread",
    async () => {
      const pending = await expectedPending();
      equal(pending, [USERS.playerB], "pending and matched");
      const denied = await answer(USERS.playerA, "Manage");
      expect(
        String(denied.shown()?.content).includes("Only the roster's creator"),
        "others are refused",
      );

      const ask = await manage(USERS.owner, "Ping pending");
      const question = String(ask.shown()?.content);
      expect(question.includes(`Ping ${pending.length} player`), `confirmation: ${question}`);
      expect(question.includes("weren't matched"), `mentions the unmatched player: ${question}`);
      equal(labelsIn(ask.shown()), ["Ping", "Cancel"], "confirmation buttons");
      expect(
        !question.includes("can't use a thread"),
        `the test channel allows threads: ${question}`,
      );
      equal((await threadMessages().catch(() => [])).length, 0, "nothing sent before confirming");

      const done = await click(
        USERS.owner,
        channel.id,
        buttonIn(ask.shown(), "Ping"),
        "private-ping",
      );
      expect(
        String(done.shown()?.content).includes("roster's thread"),
        `got ${JSON.stringify(done.shown())}`,
      );
      const thread: any = await tester.get(Routes.channel(messageId));
      equal(thread.name, "Roster pings", "thread name");
      const [sent] = await threadMessages();
      expect(Boolean(sent), "a ping in the thread");
      equal(
        sent.mentions.map((u: any) => u.id).sort(),
        [...pending].sort(),
        "mentioned users are exactly the pending ones",
      );
      equal(sent.mention_everyone, false, "no @everyone");
      equal(sent.mention_roles, [], "no roles");
    },
  );

  await step("a second ping is refused during the cooldown", async () => {
    const again = await manage(USERS.owner, "Ping pending");
    expect(
      String(again.shown()?.content).includes("pinged recently"),
      `got ${JSON.stringify(again.shown())}`,
    );
  });

  await step("after the cooldown, a ping reuses the thread, even archived", async () => {
    forgetPingCooldown(rosterId);
    const archived = await client.rest
      .patch(Routes.channel(messageId), { body: { archived: true } })
      .then(() => true)
      .catch(() => false);
    const { done } = await pingFromPanel();
    expect(
      String(done.shown()?.content).includes("roster's thread"),
      `got ${JSON.stringify(done.shown())}`,
    );
    equal((await threadMessages()).length, 2, "both pings in the same thread");
    if (archived) {
      const thread: any = await tester.get(Routes.channel(messageId));
      equal(thread.thread_metadata?.archived, false, "unarchived to ping");
    } else {
      console.log("        (the bot can't archive threads here, so unarchiving wasn't tested)");
    }
    forgetPingCooldown(rosterId);
  });
  if (setAside) await database.db.insert(responses).values(setAside);

  await step("a refusal on the public roster is private and removes itself", async () => {
    const denied = await answer(USERS.playerA, "Manage");
    equal(
      denied.calls.map((c) => c.method),
      ["reply"],
      "a private reply, leaving the roster alone",
    );
    await sleep(14_000);
    expect(!deleted(denied), "still shown after 14 seconds");
    await sleep(1_500);
    expect(deleted(denied), "removed after about 15 seconds");
  });

  // ----- 7. editing a posted roster
  let editor!: Fake;
  await step("only the owner can edit; the owner gets a private editor", async () => {
    const denied = await answer(USERS.playerA, "Manage");
    expect(
      String(denied.shown()?.content).includes("Only the roster's creator"),
      `got ${JSON.stringify(denied.shown())}`,
    );
    equal((await rowFor(rosterId))!.status, "posted", "status after refusal");
    editor = await manage(USERS.owner, "Edit roster");
    equal(
      editor.calls.map((c) => c.method),
      ["update"],
      "Edit roster turns the Manage panel into the editor, with no new message",
    );
    equal(
      labelsIn(editor.shown()).slice(-3),
      ["Update roster", "Refresh preview", "Discard changes"],
      "editor buttons",
    );
    expect(String(editor.shown().content).includes(`/r/${token}`), "same private link");
    const row = (await rowFor(rosterId))!;
    equal(row.status, "editing", "status");
    expect(Boolean(row.previewToken), "new preview token held");
  });

  await step(
    "while editing, the public roster doesn't change, and answers still count the posted version",
    async () => {
      const mark = previews.length;
      // Move playerC to the bench in the draft.
      equal(
        (await webPut(token, { assignments: { "0": 1, "1": 1, "2": 2, "5": 3 } })).status,
        200,
        "save",
      );
      const update = await until("editor preview", async () =>
        previews.slice(mark).find((p) => p.body?.embeds?.length),
      );
      expect(
        update.token === (await rowFor(rosterId))!.previewToken,
        "preview goes to the editor message",
      );
      const view = describe(await publicMessage(channel.id, messageId));
      expect(
        view.fields["BLACKSPEAR"]?.includes(`<@${USERS.playerC}>`),
        "playerC still in BLACKSPEAR publicly",
      );
      await answer(USERS.playerA, "Backup");
      const after = await waitFor("Backup 2", (v) => v.description.includes("Backup: 2"));
      expect(after.description.includes("/5"), `still 5 listed publicly: ${after.description}`);
    },
  );

  await step("Update roster changes the public message and keeps answers", async () => {
    const out = await click(
      USERS.owner,
      channel.id,
      buttonIn(editor.shown(), "Update roster"),
      "private-3",
    );
    expect(
      String(out.shown()?.content).includes("Roster updated"),
      `got ${JSON.stringify(out.shown())}`,
    );
    const view = describe(await publicMessage(channel.id, messageId));
    expect(view.description.includes("/4"), `now 4 listed: ${view.description}`);
    expect(view.fields["Bench"]?.includes(NAMES.playerC), `bench: ${view.fields["Bench"]}`);
    expect(!view.fields["BLACKSPEAR"]?.includes(NAMES.playerC), "playerC removed from BLACKSPEAR");
    equal((await rowFor(rosterId))!.status, "posted", "status");
    equal(Object.keys(await answersOf()).length >= 4, true, "answers kept");
  });

  await step("Discard changes restores the posted roster", async () => {
    editor = await manage(USERS.owner, "Edit roster");
    await webPut(token, { assignments: { "0": 1 } });
    const out = await click(
      USERS.owner,
      channel.id,
      buttonIn(editor.shown(), "Discard changes"),
      "private-4",
    );
    expect(
      String(out.shown()?.content).includes("Changes discarded"),
      `got ${JSON.stringify(out.shown())}`,
    );
    const row = (await rowFor(rosterId))!;
    equal(row.status, "posted", "status");
    equal(row.assignments, row.postedAssignments, "draft restored to the posted roster");
    equal(
      (await webPut(token, { assignments: { "0": 1 } })).status,
      409,
      "web page is locked again",
    );
  });

  await step(
    "renamed squads, a leader and a hidden bench apply on Update, and Discard undoes them",
    async () => {
      const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];
      const placed = { "0": 1, "1": 1, "2": 2, "5": 3 };
      const changes = {
        assignments: placed,
        squadNames: names,
        squadLeaders: { "1": 1 },
        showBench: false,
        showBanner: true,
        embedStyle: {
          description: "E2E orders",
          leaderEmoji: { id: emoji.id, name: emoji.name },
        },
      };

      editor = await manage(USERS.owner, "Edit roster");
      equal((await webPut(token, changes)).status, 200, "save");
      const before = describe(await publicMessage(channel.id, messageId));
      expect(Boolean(before.fields["CERBERUS"]), "public roster unchanged until Update");

      await click(USERS.owner, channel.id, buttonIn(editor.shown(), "Update roster"), "private-5");
      const view = describe(await publicMessage(channel.id, messageId));
      const lines = view.fields["ALPHA"]?.split("\n") ?? [];
      expect(lines[0]?.includes(`<@${USERS.playerA}>`), `leader first: ${lines[0]}`);
      expect(!lines[1]?.includes("👑"), "only the leader has the emblem");
      expect(!view.fields["Bench"], "bench hidden");
      expect(view.description.includes("E2E orders"), `description: ${view.description}`);
      expect(lines[0]?.includes("<:e2e_ok:"), `server emoji as the emblem: ${lines[0]}`);
      const raw = await publicMessage(channel.id, messageId);
      // The art is optional (ASSETS_DIR), so these only count when the files are there.
      if (readAsset(BANNER_FILE))
        expect(Boolean(raw.embeds[0].image?.url), "the banner reached Discord");
      if (readAsset(CREST_FILE))
        expect(Boolean(raw.embeds[0].author?.icon_url), "the crest reached Discord");
      await answer(USERS.playerA, "Backup");
      const redrawn = await waitFor("redraw keeps the banner", (v) =>
        v.description.includes("Backup"),
      );
      const afterRedraw = await publicMessage(channel.id, messageId);
      // Only the bot sees its own message's attachments. Those in the embed aren't listed.
      const asBot = (await client.rest.get(Routes.channelMessage(channel.id, messageId))) as any;
      equal(asBot.attachments.length, 0, "a redraw keeps the pictures inside the embed");
      if (readAsset(BANNER_FILE))
        expect(Boolean(afterRedraw.embeds[0].image?.url), `banner kept: ${redrawn.title}`);

      editor = await manage(USERS.owner, "Edit roster");
      await webPut(token, { assignments: placed, squadNames: names.map((n) => `${n}2`) });
      await click(
        USERS.owner,
        channel.id,
        buttonIn(editor.shown(), "Discard changes"),
        "private-6",
      );
      equal((await rowFor(rosterId))!.squadNames, names, "names restored by Discard");
    },
  );

  await step("the roster image banner reaches Discord and stays in the embed", async () => {
    const placed = { "0": 1, "1": 1, "2": 2, "5": 3 };
    editor = await manage(USERS.owner, "Edit roster");
    const embedStyle = { bannerImage: "roster" };
    equal(
      (await webPut(token, { assignments: placed, showBanner: true, embedStyle })).status,
      200,
      "save",
    );
    await click(USERS.owner, channel.id, buttonIn(editor.shown(), "Update roster"), "private-10");
    const asBot = async () =>
      (await client.rest.get(Routes.channelMessage(channel.id, messageId))) as any;
    const posted = await asBot();
    expect(String(posted.embeds[0].image?.url).includes("roster.png"), "the picture is the banner");
    equal(posted.attachments.length, 0, "the picture is inside the embed");
    await answer(USERS.playerA, "Late");
    await waitFor("redraw", (v) => v.description.includes("Late"));
    const after = await asBot();
    expect(Boolean(after.embeds[0].image?.url), "the picture survives a redraw");
    equal(after.attachments.length, 0, "and stays inside the embed");
  });

  await step("a server's saved squad names start its next roster", async () => {
    const names = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"];
    equal(
      (await webPut(`${token}/default-squad-names`, { squadNames: names })).status,
      200,
      "save",
    );
    const begin = await runCommand(USERS.owner, channel.id, link(apollo.id));
    const next = await click(
      USERS.owner,
      channel.id,
      buttonIn(begin.shown(), "Continue"),
      "private-9",
    );
    const row = await newestRow();
    equal(row.squadNames, names, "new roster's names");
    await click(USERS.owner, channel.id, buttonIn(next.shown(), "Cancel"), "private-9");
    // Later runs expect the usual names. Neither role may delete a server's default.
    await webPut(`${token}/default-squad-names`, { squadNames: DEFAULT_SQUAD_NAMES });
  });

  // ----- 8. deleting
  await step("only the owner can delete, and deleting asks twice", async () => {
    const denied = await answer(USERS.playerA, "Manage");
    expect(
      String(denied.shown()?.content).includes("Only the roster's creator"),
      `got ${JSON.stringify(denied.shown())}`,
    );
    const ask = await manage(USERS.owner, "Delete");
    equal(labelsIn(ask.shown()), ["Delete roster", "Keep roster"], "confirmation buttons");
    const kept = await click(
      USERS.owner,
      channel.id,
      buttonIn(ask.shown(), "Keep roster"),
      "private-5",
    );
    expect(
      String(kept.shown()?.content).includes("No changes were made"),
      `got ${JSON.stringify(kept.shown())}`,
    );
    expect(Boolean(await rowFor(rosterId)), "roster still stored after Keep");
    await publicMessage(channel.id, messageId); // still there, or this throws
  });

  await step("confirming Delete removes the message, the roster and its answers", async () => {
    const ask = await manage(USERS.owner, "Delete");
    const done = await click(
      USERS.owner,
      channel.id,
      buttonIn(ask.shown(), "Delete roster"),
      "private-6",
    );
    expect(
      String(done.shown()?.content).includes("Roster deleted"),
      `got ${JSON.stringify(done.shown())}`,
    );
    equal(await rowFor(rosterId), undefined, "roster row");
    equal(
      (await database.db.select().from(responses).where(eq(responses.instanceId, rosterId))).length,
      0,
      "answers",
    );
    const gone = await publicMessage(channel.id, messageId).then(
      () => false,
      () => true,
    );
    expect(gone, "public message is gone");
    equal((await webGet(token)).status, 404, "web link");
  });

  await step("old buttons on a deleted roster say it's no longer active", async () => {
    const out = await click(
      USERS.playerA,
      channel.id,
      `build-roster:answer:${rosterId}:confirmed`,
      messageId,
    );
    expect(
      String(out.shown()?.content).includes("no longer active"),
      `got ${JSON.stringify(out.shown())}`,
    );
  });

  // ----- 9. leaving before posting
  await step(
    "posting with nobody in a squad is refused, and Cancel removes the draft",
    async () => {
      const begin = await runCommand(USERS.owner, channel.id, link(apollo.id));
      const next = await click(
        USERS.owner,
        channel.id,
        buttonIn(begin.shown(), "Continue"),
        "private-7",
      );
      const row = await newestRow();
      const refused = await click(
        USERS.owner,
        channel.id,
        buttonIn(next.shown(), "Post roster"),
        "private-7",
        next.shown().content,
      );
      const shown = refused.shown();
      expect(
        String(shown?.content).startsWith("> ⚠️ No players have been placed"),
        `got ${JSON.stringify(shown)}`,
      );
      expect(String(shown.content).includes(`/r/${row.token}`), "the draft keeps its link");
      equal(shown.components, undefined, "the draft keeps its buttons");
      equal(
        refused.calls.filter((c) => ["reply", "followUp"].includes(c.method)).length,
        0,
        "no extra private message",
      );
      equal((await rowFor(row.id))!.status, "draft", "still a draft");
      const cancelled = await click(
        USERS.owner,
        channel.id,
        buttonIn(next.shown(), "Cancel"),
        "private-7",
      );
      expect(
        String(cancelled.shown()?.content).includes("Roster cancelled"),
        `got ${JSON.stringify(cancelled.shown())}`,
      );
      equal(await rowFor(row.id), undefined, "draft row");
      equal((await webGet(row.token)).status, 404, "web link");
    },
  );

  await step("another person can't use the owner's buttons", async () => {
    const begin = await runCommand(USERS.owner, channel.id, link(apollo.id));
    const next = await click(
      USERS.owner,
      channel.id,
      buttonIn(begin.shown(), "Continue"),
      "private-8",
    );
    const row = await newestRow();
    const out = await click(
      USERS.playerA,
      channel.id,
      buttonIn(next.shown(), "Cancel"),
      "private-8",
    );
    expect(
      String(out.shown()?.content).includes("Only the roster's creator"),
      `got ${JSON.stringify(out.shown())}`,
    );
    expect(Boolean(await rowFor(row.id)), "roster untouched");
    await click(USERS.owner, channel.id, buttonIn(next.shown(), "Cancel"), "private-8");
  });
} finally {
  await worker.stop();
  webProcess.kill();
  // The test channel, the category and the emoji only exist for this run.
  if (created.emoji)
    await tester.delete(Routes.guildEmoji(GUILD, created.emoji)).catch(() => undefined);
  for (const id of [created.channel, created.category])
    if (id) await tester.delete(Routes.channel(id)).catch(() => undefined);
  await client.destroy();
  await database.sql.end({ timeout: 5 });
}
console.log(failures === 0 ? "All steps passed" : `${failures} step(s) failed`);
process.exit(failures === 0 ? 0 : 1);
