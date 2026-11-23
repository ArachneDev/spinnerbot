import { readFileSync } from "node:fs";
import type { Guild, GuildMember } from "discord.js";

/** TesterBot's APPID and TOKEN, from testerBot/testerBot_creds (git-ignored, two KEY=value lines). */
export function testerCreds(): { appId: string; token: string } {
  let text: string;
  try {
    text = readFileSync(new URL("../../../testerBot/testerBot_creds", import.meta.url), "utf8");
  } catch {
    throw new Error(
      "testerBot/testerBot_creds is missing. It needs APPID=... and TOKEN=... lines.",
    );
  }
  const creds = Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [
        line.slice(0, line.indexOf("=")).trim(),
        line.slice(line.indexOf("=") + 1).trim(),
      ]),
  );
  if (!creds["APPID"] || !creds["TOKEN"])
    throw new Error("testerBot_creds needs APPID= and TOKEN=");
  return { appId: creds["APPID"], token: creds["TOKEN"] };
}

export function devGuildId(): string {
  const id = process.env["DISCORD_DEV_GUILD_ID"];
  if (!id) throw new Error("DISCORD_DEV_GUILD_ID is not set in .env");
  return id;
}

/**
 * Members of the test server who can stand in for people, read at run time: not the dev app or
 * TesterBot, and only those whose name no other member shares, because the bot matches Apollo's
 * names to members by name and only trusts a single match.
 */
export async function standIns(
  guild: Guild,
  exclude: string[],
): Promise<{ humans: GuildMember[]; bots: GuildMember[] }> {
  const members = [
    ...(
      await guild.members.list({ limit: 1000 }).catch(() => {
        throw new Error(
          "Could not list the test server's members. Switch on the Server Members intent for the dev app in the Developer Portal.",
        );
      })
    ).values(),
  ];
  const names = (m: GuildMember) =>
    [m.displayName, m.nickname, m.user.globalName, m.user.username]
      .filter((n): n is string => Boolean(n))
      .map((n) => n.trim().toLowerCase());
  const seen = new Map<string, number>();
  for (const member of members)
    for (const name of new Set(names(member))) seen.set(name, (seen.get(name) ?? 0) + 1);
  const usable = members.filter(
    (m) => !exclude.includes(m.id) && names(m).every((name) => seen.get(name) === 1),
  );
  return { humans: usable.filter((m) => !m.user.bot), bots: usable.filter((m) => m.user.bot) };
}
