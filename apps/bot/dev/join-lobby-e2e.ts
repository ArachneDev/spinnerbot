/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn } from "node:child_process";
import { Client, GatewayIntentBits, type GuildMember, REST, Routes } from "discord.js";
import { eq, inArray } from "drizzle-orm";
import { parseSteamProfilePage, parseSteamRef, steamProfileUrl } from "@scrimbot/core";
import { createDatabase, schema } from "@scrimbot/db";
import { devRoleUrl } from "./dev-roles.js";
import { devGuildId, standIns, testerCreds } from "./tester.js";
import { features } from "../src/features/index.js";
import { steam } from "../src/features/join-lobby/steam.js";
import { loadConfig } from "../src/framework/config.js";
import { createLogger } from "../src/framework/logger.js";
import { createPythonBridge } from "../src/framework/python.js";
import { buildRegistry } from "../src/framework/registry.js";
import { routeInteraction } from "../src/framework/router.js";
import type { FeatureContext } from "../src/framework/types.js";

// Dev tool: runs /join-lobby end to end against the real test server.
//
// What is real: the bot's login and voice state, TesterBot sitting in a voice channel, the command
// and button code, the database as the restricted role, the public messages (TesterBot reads them
// back), and the web page that hands over to Steam. The run makes its own category, text channel and
// voice channel, and deletes them at the end.
// What is simulated: commands, presses and modals are stand-in interactions, as Discord only lets
// people send those. And one Steam answer is replaced with a lobby, because a real one exists only
// while somebody is in a game. Steam is not called: the made-up Steam IDs below get a stand-in
// profile page. Two steps use the real steamcommunity.com, and run only when E2E_STEAM_PROFILE (a
// profile link, SteamID64 or friend code) or E2E_STEAM_VANITY (a vanity name) is set in .env.
// Private answers are captured here rather than shown.
//
// Usage: pnpm --filter @scrimbot/bot join-lobby:e2e. Stop `pnpm dev` first.

const GUILD = devGuildId();
const creds = testerCreds();
const tester = new REST().setToken(creds.token);
const testerId = creds.appId;

// Members of the test server who stand in for people, picked after login. Bots first, so nobody
// real gets a link saved.
let LINKED_VIEWER = "";
let NEWCOMER = "";
let NEWCOMER_2 = "";
// Made-up Steam accounts. None of them exist, so the run never needs the network for them.
const VIEWER_FRIEND_CODE = "39734283";
const VIEWER_STEAM = "76561198000000011";
const TESTER_STEAM = "76561198000000012";
const NEWCOMER_STEAM = "76561198000000013";
const NEWCOMER_2_STEAM = "76561198000000014";
const CHANGED_STEAM = "76561198000000015";
const MADE_UP = new Set([
  VIEWER_STEAM,
  TESTER_STEAM,
  NEWCOMER_STEAM,
  NEWCOMER_2_STEAM,
  CHANGED_STEAM,
]);
const LOBBY = { appId: "686810", lobbyId: "109775241000000000", steamId: TESTER_STEAM };
// Optional, from .env: real Steam pages, fetched from steamcommunity.com.
const LIVE_PROFILE = process.env["E2E_STEAM_PROFILE"]?.trim();
const LIVE_VANITY = process.env["E2E_STEAM_VANITY"]?.trim();
const liveProfileRef = LIVE_PROFILE ? parseSteamRef(LIVE_PROFILE) : undefined;
if (LIVE_PROFILE && !liveProfileRef) throw new Error("E2E_STEAM_PROFILE is not a Steam profile");
const liveUrls = new Set(
  [
    liveProfileRef,
    LIVE_VANITY ? ({ kind: "vanity", vanity: LIVE_VANITY } as const) : undefined,
  ].flatMap((ref) => (ref ? [steamProfileUrl(ref).toLowerCase()] : [])),
);

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(what: string, check: () => T | undefined | false, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(200);
  }
}

// ---- the real bot, wired as main.ts does it ---------------------------------------------------

const config = loadConfig();
const log = createLogger("warn");
const registry = buildRegistry(features);
const database = createDatabase(devRoleUrl(config.databaseUrl, "scrimbot_bot"));
const client = new Client({ intents: registry.intents });
const context: FeatureContext = {
  client,
  database,
  log,
  python: createPythonBridge({ log, pythonBin: config.pythonBin }),
  publicUrl: config.publicUrl,
};
const { steamProfiles } = schema;
const linkOf = async (user: string) =>
  (await database.db.select().from(steamProfiles).where(eq(steamProfiles.discordUserId, user)))[0];

// Made-up IDs get a stand-in profile page, and only the tester's one has a lobby, and only while
// testerInLobby is set. Anything else is "not found", unless .env names a real profile to use.
const realCheck = steam.check.bind(steam);
let testerInLobby = false;
steam.check = async (ref) => {
  if (liveUrls.has(steamProfileUrl(ref).toLowerCase())) return realCheck(ref);
  if (ref.kind !== "id" || !MADE_UP.has(ref.steamId)) return { status: "missing" };
  const page = parseSteamProfilePage(`"steamid":"${ref.steamId}"`)!;
  if (ref.steamId === TESTER_STEAM && testerInLobby) {
    return { status: "found", page: { ...page, gameName: "Hell Let Loose", lobby: LOBBY } };
  }
  return { status: "found", page };
};
/** A step that needs the real Steam, so it runs only when .env asks for it. */
async function liveStep(name: string, envVar: string, run: () => Promise<void>) {
  if (process.env[envVar]?.trim()) await step(name, run);
  else console.log(`SKIP  ${name} (set ${envVar} in .env to run it)`);
}

const WEB_PORT = 3918;
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

// ---- stand-in interactions --------------------------------------------------------------------

interface Fake {
  modal?: any;
  /** What was really posted in the channel. */
  posted: any[];
  /** The latest private answer. */
  shown?: any;
  ephemeralDefer?: boolean;
}

let channelId = "";
const created: { category?: string; channel?: string; voice?: string } = {};
const toJson = (value: unknown) => JSON.parse(JSON.stringify(value));

async function send(
  user: string,
  extra: Record<string, unknown>,
  { fromMessage = false } = {},
): Promise<Fake> {
  const guild = await client.guilds.fetch(GUILD);
  const channel: any = await client.channels.fetch(channelId);
  const fake: Fake = { posted: [] };
  const postReally = async (payload: any) => {
    const message = await channel.send(payload);
    fake.posted.push(await tester.get(Routes.channelMessage(channelId, message.id)));
  };
  const base: any = {
    client,
    guild,
    guildId: GUILD,
    channelId,
    user: { id: user, bot: false },
    memberPermissions: { has: () => true },
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isFromMessage: () => fromMessage,
    showModal: async (modal: any) => {
      base.replied = true;
      fake.modal = toJson(modal);
    },
    reply: async (payload: any) => {
      base.replied = true;
      fake.shown = toJson(payload);
      fake.ephemeralDefer = Boolean(payload.flags);
    },
    deferReply: async (options: any) => {
      base.deferred = true;
      fake.ephemeralDefer = Boolean(options?.flags);
    },
    deferUpdate: async () => {
      base.deferred = true;
      fake.ephemeralDefer = true;
    },
    // A public deferral is answered in the channel, and a private one only to the person.
    editReply: async (payload: any) => {
      if (fake.ephemeralDefer) fake.shown = toJson(payload);
      else await postReally(payload);
    },
    followUp: async (payload: any) => {
      if (payload.flags) fake.shown = toJson(payload);
      else await postReally(payload);
    },
    ...extra,
  };
  await routeInteraction(base, registry, context);
  return fake;
}

const runCommand = (user: string) =>
  send(user, {
    commandName: "join-lobby",
    isChatInputCommand: () => true,
    options: { get: () => null },
  });
const linkCommand = (user: string, profile: string) =>
  send(user, {
    commandName: "link-steam",
    isChatInputCommand: () => true,
    options: { get: (name: string) => (name === "profile" ? { value: profile } : null) },
  });
const press = (user: string, customId: string) =>
  send(user, { customId, isMessageComponent: () => true });
const submitModal = (user: string, customId: string, profile: string, fromMessage: boolean) =>
  send(
    user,
    {
      customId,
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => profile },
    },
    { fromMessage },
  );

const buttons = (message: any): any[] =>
  (message?.components ?? []).flatMap((r: any) => r.components);
const byLabel = (message: any, label: string) => {
  const found = buttons(message).find((button) => button.label === label);
  if (!found) throw new Error(`No "${label}" button in ${JSON.stringify(message)}`);
  return found;
};

// ---- the run ----------------------------------------------------------------------------------

const testerClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
await client.login(config.discordToken);
await new Promise<void>((resolve) => client.once("clientReady", () => resolve()));
await testerClient.login(creds.token);
await new Promise<void>((resolve) => testerClient.once("clientReady", () => resolve()));
/** Stops the run before it starts, with the reason. */
async function bail(message: string): Promise<never> {
  console.error(message);
  webProcess.kill();
  await testerClient.destroy();
  await client.destroy();
  await database.sql.end({ timeout: 5 });
  process.exit(2);
}
{
  const { bots, humans } = await standIns(await client.guilds.fetch(GUILD), [
    client.user!.id,
    testerId,
  ]);
  const people: GuildMember[] = [...bots, ...humans];
  const [a, b, c] = people;
  if (!a || !b || !c) {
    await bail(
      `The test server needs 3 members besides the dev app and TesterBot, each with a name no ` +
        `one else has (bots are best, so nobody real gets a link saved). It has ${people.length}.`,
    );
  } else {
    [LINKED_VIEWER, NEWCOMER, NEWCOMER_2] = [a.id, b.id, c.id];
  }
}
const testIds = [LINKED_VIEWER, NEWCOMER, NEWCOMER_2, testerId];
await database.db.delete(steamProfiles).where(inArray(steamProfiles.discordUserId, testIds));

const setTesterVoice = (channel: string | null) =>
  testerClient.guilds.cache.get(GUILD)!.shard.send({
    op: 4,
    d: { guild_id: GUILD, channel_id: channel, self_mute: true, self_deaf: true },
  });

try {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const category: any = await tester.post(Routes.guildChannels(GUILD), {
    body: { name: `join-lobby-e2e-${stamp}`, type: 4 },
  });
  created.category = category.id;
  const channel: any = await tester.post(Routes.guildChannels(GUILD), {
    body: { name: `join-lobby-e2e-${stamp}`, type: 0, parent_id: category.id },
  });
  created.channel = channel.id;
  channelId = channel.id;
  const voiceName = `join-lobby-e2e-voice-${stamp}`;
  const voice: any = await tester.post(Routes.guildChannels(GUILD), {
    body: { name: voiceName, type: 2, parent_id: category.id },
  });
  created.voice = voice.id;
  const VOICE_CHANNEL: string = voice.id;
  console.log(`Test channel #${channel.name} (${channel.id}), voice ${voiceName}\n`);

  setTesterVoice(VOICE_CHANNEL);
  await step("the bot sees TesterBot in the voice channel", async () => {
    const guild = await client.guilds.fetch(GUILD);
    await until(
      "voice state",
      () => guild.voiceStates.cache.get(testerId)?.channelId === VOICE_CHANNEL,
    );
  });

  await step(
    "/join-lobby asks an unlinked person for their profile, and posts nothing",
    async () => {
      const out = await runCommand(NEWCOMER);
      expect(
        out.modal?.custom_id === "join-lobby:link:command",
        `modal ${JSON.stringify(out.modal)}`,
      );
      expect(out.posted.length === 0, "posted something");
      expect(!(await linkOf(NEWCOMER)), "saved something");
    },
  );

  await step(
    "the modal turns away something that isn't a profile, and offers another go",
    async () => {
      const out = await submitModal(NEWCOMER, "join-lobby:link:command", "not a profile", false);
      expect(String(out.shown?.content).includes("not a valid Steam"), JSON.stringify(out));
      byLabel(out.shown, "Add Steam profile");
      expect(buttons(out.shown).length === 1, "from the command there is nothing to skip to");
      expect(!(await linkOf(NEWCOMER)), "saved something");
    },
  );

  await step("the modal turns away a profile Steam doesn't have", async () => {
    const out = await submitModal(
      NEWCOMER,
      "join-lobby:link:command",
      "https://steamcommunity.com/id/spinnerbot-no-such-profile-e2e/",
      false,
    );
    expect(String(out.shown?.content).includes("No Steam profile was found"), JSON.stringify(out));
  });

  await step("a valid profile links them as the restricted role, then posts the list", async () => {
    const out = await submitModal(
      NEWCOMER,
      "join-lobby:link:command",
      `https://steamcommunity.com/profiles/${NEWCOMER_STEAM}/`,
      false,
    );
    expect((await linkOf(NEWCOMER))?.steamId === NEWCOMER_STEAM, "not saved");
    expect(String(out.shown?.content).startsWith("Steam profile linked"), JSON.stringify(out));
    expect(out.posted.length === 1, `posted ${out.posted.length}`);
  });

  await step("a friend code is stored as the full Steam ID", async () => {
    await linkCommand(LINKED_VIEWER, VIEWER_FRIEND_CODE);
    expect((await linkOf(LINKED_VIEWER))?.steamId === VIEWER_STEAM, "friend code not converted");
  });

  await step("one Steam account can't be linked by two people", async () => {
    await database.db.delete(steamProfiles).where(eq(steamProfiles.discordUserId, NEWCOMER_2));
    await database.db
      .insert(steamProfiles)
      .values({ discordUserId: testerId, steamId: TESTER_STEAM });
    const out = await linkCommand(NEWCOMER_2, TESTER_STEAM);
    expect(String(out.shown?.content).includes("already linked"), JSON.stringify(out));
    expect(!(await linkOf(NEWCOMER_2)), "saved despite the conflict");
  });

  let publicMessage: any;
  await step("a linked person gets a real public embed showing the voice channel", async () => {
    testerInLobby = true;
    const out = await runCommand(LINKED_VIEWER);
    publicMessage = out.posted[0];
    const embed = publicMessage?.embeds?.[0];
    expect(embed?.title === "Join game", JSON.stringify(publicMessage));
    const field = embed.fields.find((f: any) => f.name.includes(voiceName));
    expect(field?.value.includes("Joinable in Hell Let Loose"), JSON.stringify(embed.fields));
    const join = buttons(publicMessage)[0];
    expect(join?.custom_id === `join-lobby:join:${testerId}`, JSON.stringify(join));
    console.log(`        embed field: ${field.name} | ${field.value}`);
  });
  const joinId = `join-lobby:join:${testerId}`;

  let joinUrl = "";
  await step("a linked person's press gets a private link to the join page", async () => {
    const out = await press(LINKED_VIEWER, joinId);
    expect(out.ephemeralDefer, "was public");
    expect(out.posted.length === 0, "posted publicly");
    const link = byLabel(out.shown, "Join game");
    joinUrl = link.url;
    expect(joinUrl.startsWith(`${config.publicUrl}/api/join-lobby/`), joinUrl);
    expect(String(out.shown.content).includes("Hell Let Loose"), JSON.stringify(out.shown));
  });

  await step("Discord accepts that link on a real button", async () => {
    const message: any = await ((await client.channels.fetch(channelId)) as any).send({
      content: "Link button check",
      components: [
        { type: 1, components: [{ type: 2, style: 5, label: "Join game", url: joinUrl }] },
      ],
    });
    expect(message.components.length === 1, "button missing");
  });

  await step("the web page hands over to Steam", async () => {
    let response: Response | undefined;
    for (let i = 0; i < 30 && !response?.ok; i++) {
      response = await fetch(`http://127.0.0.1:${WEB_PORT}/healthz`).catch(() => undefined);
      if (!response?.ok) await sleep(500);
    }
    const page = await fetch(joinUrl.replace(config.publicUrl, `http://127.0.0.1:${WEB_PORT}`));
    const html = await page.text();
    const wanted = `steam://joinlobby/${LOBBY.appId}/${LOBBY.lobbyId}/${LOBBY.steamId}`;
    expect(page.status === 200 && html.includes(`href="${wanted}"`), html);
    expect(html.includes(`url=${wanted}`), "no automatic redirect");
  });

  await step("an unlinked person's press offers Add and Skip, privately", async () => {
    const out = await press(NEWCOMER_2, joinId);
    expect(out.ephemeralDefer, "was public");
    byLabel(out.shown, "Add Steam profile");
    byLabel(out.shown, "Skip for now");
    expect(!(await linkOf(NEWCOMER_2)), "saved something");
  });

  await step("Skip still gets them the link, and saves nothing", async () => {
    const out = await press(NEWCOMER_2, `join-lobby:skip:${testerId}`);
    byLabel(out.shown, "Join game");
    expect(!(await linkOf(NEWCOMER_2)), "saved something");
  });

  await step("Add opens the modal, and sending it links them and gives the link", async () => {
    const opened = await press(NEWCOMER_2, `join-lobby:add:${testerId}`);
    expect(opened.modal?.custom_id === `join-lobby:link:${testerId}`, JSON.stringify(opened));
    const out = await submitModal(NEWCOMER_2, opened.modal.custom_id, VIEWER_STEAM, true);
    // The viewer already has this account, so they are told so and can still skip.
    expect(String(out.shown?.content).includes("already linked"), JSON.stringify(out.shown));
    byLabel(out.shown, "Skip for now");
    const second = await submitModal(
      NEWCOMER_2,
      opened.modal.custom_id,
      `https://steamcommunity.com/profiles/${NEWCOMER_2_STEAM}/`,
      true,
    );
    expect((await linkOf(NEWCOMER_2))?.steamId === NEWCOMER_2_STEAM, "not saved");
    byLabel(second.shown, "Join game");
  });

  await step("a press when the lobby has closed says so", async () => {
    testerInLobby = false;
    const out = await press(LINKED_VIEWER, joinId);
    expect(String(out.shown?.content).includes("has no open lobby"), JSON.stringify(out));
    expect(buttons(out.shown).length === 0, "still offers a join button");
  });

  await step("a profile with no lobby shows as no open lobby in the list", async () => {
    const out = await runCommand(LINKED_VIEWER);
    const field = out.posted[0].embeds[0].fields.find((f: any) => f.name.includes(voiceName));
    expect(field?.value.includes("No open lobby"), JSON.stringify(field));
    const labels = buttons(out.posted[0]).map((button: any) => button.label);
    expect(labels.join() === "Refresh,Delete", `button without a lobby: ${labels.join()}`);
    console.log(`        embed field: ${field.name} | ${field.value}`);
  });

  await step("/link-steam can change someone's own profile", async () => {
    await linkCommand(NEWCOMER, `https://steamcommunity.com/profiles/${CHANGED_STEAM}/`);
    expect((await linkOf(NEWCOMER))?.steamId === CHANGED_STEAM, "not changed");
  });

  // These two read the real steamcommunity.com, so they run only when .env names a profile.
  await liveStep(
    "a real Steam profile links as the person wrote it",
    "E2E_STEAM_PROFILE",
    async () => {
      await linkCommand(NEWCOMER, LIVE_PROFILE!);
      const wanted = liveProfileRef?.kind === "id" ? liveProfileRef.steamId : undefined;
      const saved = (await linkOf(NEWCOMER))?.steamId;
      expect(saved !== undefined && saved !== CHANGED_STEAM, "not linked");
      expect(!wanted || saved === wanted, `linked ${saved}`);
    },
  );
  await liveStep(
    "a real vanity link is resolved to the full Steam ID",
    "E2E_STEAM_VANITY",
    async () => {
      await linkCommand(NEWCOMER, `https://steamcommunity.com/id/${LIVE_VANITY}/`);
      const saved = (await linkOf(NEWCOMER))?.steamId ?? "";
      expect(/^7656119\d{10}$/.test(saved), "vanity not resolved");
      expect(saved !== CHANGED_STEAM, "still the made-up profile");
    },
  );

  setTesterVoice(null);
  await step("the list follows when TesterBot leaves voice", async () => {
    const guild = await client.guilds.fetch(GUILD);
    const testerName = (await guild.members.fetch(testerId)).displayName;
    await until("left voice", () => !guild.voiceStates.cache.get(testerId)?.channelId);
    const out = await runCommand(LINKED_VIEWER);
    const fields: any[] = out.posted[0].embeds[0].fields ?? [];
    expect(!fields.some((f) => f.value.includes(testerName)), JSON.stringify(fields));
  });
} finally {
  webProcess.kill();
  setTesterVoice(null);
  // The channels only exist for this run.
  for (const id of [created.voice, created.channel, created.category])
    if (id) await tester.delete(Routes.channel(id)).catch(() => undefined);
  await database.db.delete(steamProfiles).where(inArray(steamProfiles.discordUserId, testIds));

  await testerClient.destroy();
  await client.destroy();
  await database.sql.end({ timeout: 5 });
}
console.log(failures === 0 ? "All steps passed" : `${failures} step(s) failed`);
process.exit(failures === 0 ? 0 : 1);
