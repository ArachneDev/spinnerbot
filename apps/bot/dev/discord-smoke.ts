import { readFileSync } from "node:fs";
import { REST, Routes, type APIMessage } from "discord.js";
import { parseApolloMessage } from "@scrimbot/core";

// Dev tool: checks the Spinner Bot dev setup in the real test server, from the outside, using the
// throwaway TesterBot (credentials in testerBot/testerBot_creds, which is not committed).
//
// Bots can't run slash commands or press buttons, so this checks what a bot can: that the
// server, channel and permissions are right, that the commands are registered, and that
// anything the bot has already posted has the shape players should see.
// Usage: pnpm --filter @scrimbot/bot tester:smoke <Apollo message link>

const CREDS = new URL("../../../testerBot/testerBot_creds", import.meta.url);
const creds = Object.fromEntries(
  readFileSync(CREDS, "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [
      line.slice(0, line.indexOf("=")).trim(),
      line.slice(line.indexOf("=") + 1).trim(),
    ]),
);

const need = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const tester = new REST().setToken(need("TOKEN in testerBot_creds", creds["TOKEN"]));
const dev = new REST().setToken(need("DISCORD_TOKEN", process.env["DISCORD_TOKEN"]));
const devAppId = need("DISCORD_APPLICATION_ID", process.env["DISCORD_APPLICATION_ID"]);
const guildId = need("DISCORD_DEV_GUILD_ID", process.env["DISCORD_DEV_GUILD_ID"]);
const link = /channels\/\d+\/(\d+)\/(\d+)/.exec(process.argv[2] ?? "");
if (!link) throw new Error("Give the Apollo message link as the argument");
const [, channelId, messageId] = link as unknown as [string, string, string];

// Permission bits, from Discord's documentation.
const PERMISSIONS = {
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  Administrator: 1n << 3n,
};

let failures = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};

async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    check(false, what, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

// 1. TesterBot is in the server and can read the channel.
const me = (await tester.get(Routes.user())) as { id: string; username: string };
check(me.id === creds["APPID"], "TesterBot logs in", me.username);
const testerGuilds = (await tester.get(Routes.userGuilds())) as {
  id: string;
  permissions: string;
}[];
check(
  testerGuilds.some((g) => g.id === guildId),
  "TesterBot is in the test server",
);

// 2. The Apollo event can be read and parsed by someone who isn't the dev bot.
const apollo = await attempt(
  "TesterBot reads the Apollo message",
  async () => (await tester.get(Routes.channelMessage(channelId, messageId))) as APIMessage,
);
if (apollo) {
  check(true, "TesterBot reads the Apollo message");
  const event = await attempt("Apollo message parses", async () => parseApolloMessage(apollo));
  if (event) {
    const { accepted, declined, tentative } = event.responses;
    check(event.complete, "Apollo sign-up lists are complete", event.title);
    console.log(
      `      accepted ${accepted.length}, declined ${declined.length}, tentative ${tentative.length}`,
    );
  }
}

// 3. The dev bot is in the server, with the permissions the roster needs.
const devGuilds = (await dev.get(Routes.userGuilds())) as { id: string; permissions: string }[];
const devGuild = devGuilds.find((g) => g.id === guildId);
check(Boolean(devGuild), "ScrimBot Dev is in the test server");
if (devGuild) {
  const bits = BigInt(devGuild.permissions);
  const has = (flag: bigint) => (bits & PERMISSIONS.Administrator) !== 0n || (bits & flag) === flag;
  for (const [name, flag] of Object.entries(PERMISSIONS)) {
    if (name === "Administrator") continue;
    check(has(flag), `ScrimBot Dev has ${name} (server level)`);
  }
}

// 3b. The dev bot itself can read the Apollo embeds. Channel overrides can deny what the server
// level allows, and without the Message Content intent Discord returns the embeds empty.
const MESSAGE_CONTENT_FLAGS = (1n << 18n) | (1n << 19n); // GATEWAY_MESSAGE_CONTENT (_LIMITED)
const application = (await dev.get(Routes.currentApplication())) as { flags?: number };
check(
  (BigInt(application.flags ?? 0) & MESSAGE_CONTENT_FLAGS) !== 0n,
  "Message Content intent is enabled in the Developer Portal",
);
const asDev = await attempt(
  "ScrimBot Dev reads the Apollo message (View Channel + Read Message History in that channel)",
  async () => (await dev.get(Routes.channelMessage(channelId, messageId))) as APIMessage,
);
if (asDev) {
  check(asDev.embeds.length > 0, "ScrimBot Dev sees the Apollo embeds", `${asDev.embeds.length}`);
  check(
    (await attempt("Apollo message parses for ScrimBot Dev", async () =>
      parseApolloMessage(asDev),
    )) !== undefined,
    "Apollo message parses for ScrimBot Dev",
  );
}

// 4. The slash command is registered with the option people are told to use.
const commands = (await dev.get(Routes.applicationGuildCommands(devAppId, guildId))) as {
  name: string;
  options?: { name: string; required?: boolean }[];
}[];
const roster = commands.find((c) => c.name === "build-roster");
check(Boolean(roster), "/build-roster is registered in the test server");
check(
  roster?.options?.some((o) => o.name === "event" && o.required) ?? false,
  "/build-roster takes a required event option",
);

// 5. Anything the bot has posted in the channel looks the way players should see it.
const recent = (await tester.get(Routes.channelMessages(channelId), {
  query: new URLSearchParams({ limit: "50" }),
})) as APIMessage[];
const posted = recent.filter(
  (m) =>
    m.author.id === devAppId &&
    JSON.stringify(m.components ?? []).includes('"custom_id":"build-roster:answer:'),
);
console.log(`\nRoster messages from ScrimBot Dev in this channel: ${posted.length}`);
for (const message of posted) {
  // Rosters from before the answer buttons existed used reactions and have no components.
  if ((message.components ?? []).length === 0) {
    console.log(`SKIP  message ${message.id}: posted before answer buttons, nothing to check`);
    continue;
  }
  const [answers, manage] = (message.components ?? []) as {
    components: { custom_id?: string; label?: string }[];
  }[];
  const answerIds = answers?.components.map((c) => c.custom_id ?? "") ?? [];
  check(
    answerIds.length >= 1 &&
      answerIds.length <= 5 &&
      answerIds.every((id) => id.startsWith("build-roster:answer:")),
    `message ${message.id}: 1 to 5 answer buttons`,
    answers?.components.map((c) => c.label).join(" | "),
  );
  check(
    answerIds[0]?.endsWith(":confirmed") ?? false,
    `message ${message.id}: first button is the Confirm one`,
  );
  check(
    ["Manage", "Edit roster,Delete"].includes(
      manage?.components.map((c) => c.label).join(",") ?? "",
    ),
    `message ${message.id}: Manage (or, on older rosters, Edit roster and Delete) on the second row`,
  );
  check(
    /Confirmed \d+\/\d+/.test(message.embeds[0]?.description ?? ""),
    `message ${message.id}: shows the Confirmed counter`,
  );
  check((message.reactions ?? []).length === 0, `message ${message.id}: has no reactions`);
}

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
