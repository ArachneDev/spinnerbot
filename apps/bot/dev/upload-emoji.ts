import { readFileSync } from "node:fs";
import { REST, Routes, type RESTGetAPIOAuth2CurrentApplicationResult } from "discord.js";

// Dev tool: adds or replaces the squad leader emblem on the bot's own application. The bot finds it
// by name at startup. Use a 128x128 PNG under 256 KB.
// Usage: pnpm --filter @scrimbot/bot emoji:upload <file.png>
// For production, run it with DISCORD_TOKEN_FILE pointing at the production token.
const NAME = "squad_leader";
const env = process.env;
const tokenFile = env["DISCORD_TOKEN_FILE"];
const token = tokenFile ? readFileSync(tokenFile, "utf8").trim() : env["DISCORD_TOKEN"];
if (!token) throw new Error("Set DISCORD_TOKEN or DISCORD_TOKEN_FILE");
const file = process.argv[2];
if (!file) throw new Error("Usage: upload-emoji <file.png>");

const rest = new REST().setToken(token);
const { id } = (await rest.get(
  Routes.currentApplication(),
)) as RESTGetAPIOAuth2CurrentApplicationResult;
const { items } = (await rest.get(Routes.applicationEmojis(id))) as {
  items: { id: string; name: string }[];
};
const existing = items.find((emoji) => emoji.name === NAME);
if (existing) await rest.delete(Routes.applicationEmoji(id, existing.id));
const image = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
await rest.post(Routes.applicationEmojis(id), { body: { name: NAME, image } });
console.log(`Uploaded ${NAME}. Restart the bot to use it.`);
