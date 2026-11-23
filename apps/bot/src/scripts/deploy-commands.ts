import { REST } from "discord.js";
import { features } from "../features/index.js";
import { appSecret } from "../framework/config.js";
import { buildRegistry } from "../framework/registry.js";
import { registerCommands } from "../framework/register-commands.js";

// For development: the bot registers its commands itself when it starts.
const env = process.env;
const token = appSecret("DISCORD_TOKEN", env);
const applicationId = env["DISCORD_APPLICATION_ID"];
if (!token || !applicationId) throw new Error("Set DISCORD_TOKEN and DISCORD_APPLICATION_ID");

const rest = new REST().setToken(token);
for (const line of await registerCommands(
  rest,
  buildRegistry(features),
  applicationId,
  env["DISCORD_DEV_GUILD_ID"] || undefined,
)) {
  console.log(line);
}
