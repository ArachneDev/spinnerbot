import { readFileSync } from "node:fs";
import { parseSteamChat, type SteamRef } from "@scrimbot/core";
import { createDatabase, schema } from "@scrimbot/db";
import { REST, Routes, type APIGuildMember } from "discord.js";
import { matchMember, searchNames } from "../features/join-lobby/import-match.js";
import { steam } from "../features/join-lobby/steam.js";

// Fills steam_profiles from a Discord channel copied as text. The copy holds display names and no
// user IDs, so each name is looked up in the server, and only a single exact match counts.
// Anyone it can't match is asked for their profile the next time they use /join-lobby.
// Nothing is replaced: a link already there stays. Without --apply it only reports.
//
//   import-steam-profiles <file> <server ID> [--apply]

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [file, guildId] = args.filter((arg) => arg !== "--apply");
const tokenFile = process.env["DISCORD_TOKEN_FILE"];
const token = tokenFile ? readFileSync(tokenFile, "utf8").trim() : process.env["DISCORD_TOKEN"];
const databaseFile = process.env["DATABASE_URL_FILE"];
const databaseUrl = databaseFile
  ? readFileSync(databaseFile, "utf8").trim()
  : process.env["DATABASE_URL"];
if (!file || !guildId) throw new Error("Usage: import-steam-profiles <file> <server ID> [--apply]");
if (!token || !databaseUrl) throw new Error("Set DISCORD_TOKEN and DATABASE_URL");

const rest = new REST().setToken(token);

async function findMember(name: string) {
  for (const query of searchNames(name)) {
    const params = new URLSearchParams({ query, limit: "100" });
    const found = (await rest.get(Routes.guildMembersSearch(guildId!), {
      query: params,
    })) as APIGuildMember[];
    const match = matchMember(query, found);
    if (match !== "none") return match;
  }
  return "none" as const;
}

/** The first of what they posted that Steam knows. They may have posted more than one. */
async function resolveSteamId(refs: SteamRef[]): Promise<string | undefined> {
  for (const ref of refs) {
    const check = await steam.check(ref);
    if (check.status === "found") return check.page.steamId;
  }
  return undefined;
}

const linked: string[] = [];
const existing: string[] = [];
const unmatched: string[] = [];
const ambiguous: string[] = [];
const noSteam: string[] = [];
const { db, sql } = createDatabase(databaseUrl);
const profiles = parseSteamChat(readFileSync(file, "utf8"));

for (const { name, refs } of profiles) {
  const member = await findMember(name);
  if (member === "none") {
    unmatched.push(name);
    continue;
  }
  if (member === "ambiguous") {
    ambiguous.push(name);
    continue;
  }
  const steamId = await resolveSteamId(refs);
  if (!steamId) {
    noSteam.push(name);
    continue;
  }
  if (!apply) {
    linked.push(`${name} -> ${member.user.id} -> ${steamId}`);
    continue;
  }
  const saved = await db
    .insert(schema.steamProfiles)
    .values({ discordUserId: member.user.id, steamId })
    .onConflictDoNothing()
    .returning();
  (saved.length > 0 ? linked : existing).push(`${name} -> ${member.user.id} -> ${steamId}`);
}
await sql.end({ timeout: 5 });

function section(title: string, lines: string[]): void {
  console.log(`\n${title}: ${lines.length}`);
  for (const line of lines) console.log(`  ${line}`);
}
console.log(
  `Read ${profiles.length} people from the file${apply ? "" : " (dry run, nothing saved)"}`,
);
section(apply ? "Linked" : "Would link", linked);
section("Already linked, left as they are", existing);
section("No member with that name", unmatched);
section("More than one member with that name", ambiguous);
section("Steam doesn't know their profile, or didn't answer", noSteam);
