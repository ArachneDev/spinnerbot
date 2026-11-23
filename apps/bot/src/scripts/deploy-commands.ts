import { readFileSync } from "node:fs";
import { REST, Routes } from "discord.js";
import { features } from "../features/index.js";
import { buildRegistry } from "../framework/registry.js";

// Run on deploy, not at startup, so restarts don't spend Discord's command-registration quota.
const env = process.env;
const tokenFile = env["DISCORD_TOKEN_FILE"];
const token = tokenFile ? readFileSync(tokenFile, "utf8").trim() : env["DISCORD_TOKEN"];
const applicationId = env["DISCORD_APPLICATION_ID"];
if (!token || !applicationId) throw new Error("Set DISCORD_TOKEN and DISCORD_APPLICATION_ID");

const body = [...buildRegistry(features).commands.values()].map(({ handler }) =>
  handler.data.toJSON(),
);
const guildId = env["DISCORD_DEV_GUILD_ID"];
const route = guildId
  ? Routes.applicationGuildCommands(applicationId, guildId)
  : Routes.applicationCommands(applicationId);

const rest = new REST().setToken(token);
await rest.put(route, { body });
console.log(`Registered ${body.length} commands ${guildId ? "in the dev server" : "globally"}`);

// A server-only copy of a global command shows up twice in Discord, so global registration also
// clears any left over from registering with this app's token and a dev server set.
if (!guildId) {
  const guilds = (await rest.get(Routes.userGuilds())) as { id: string }[];
  for (const { id } of guilds) {
    const route = Routes.applicationGuildCommands(applicationId, id);
    const leftovers = (await rest.get(route)) as unknown[];
    if (leftovers.length === 0) continue;
    await rest.put(route, { body: [] });
    console.log(`Cleared ${leftovers.length} server-only commands from server ${id}`);
  }
}
