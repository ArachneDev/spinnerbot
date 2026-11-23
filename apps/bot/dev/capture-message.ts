import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { REST, Routes } from "discord.js";

// Dev tool: saves a message's raw JSON so parsers can be written against real data.
// Usage: pnpm --filter @scrimbot/bot capture:message <message link> <output file>
const env = process.env;
const tokenFile = env["DISCORD_TOKEN_FILE"];
const token = tokenFile ? readFileSync(tokenFile, "utf8").trim() : env["DISCORD_TOKEN"];
if (!token) throw new Error("Set DISCORD_TOKEN or DISCORD_TOKEN_FILE");

const [link, out] = process.argv.slice(2);
const match = /channels\/\d+\/(\d+)\/(\d+)/.exec(link ?? "");
if (!match || !out) throw new Error("Usage: capture-message <message link> <output file>");

const message = await new REST().setToken(token).get(Routes.channelMessage(match[1]!, match[2]!));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(message, null, 2)}\n`);
console.log(`Saved ${out}`);
