import { type REST, Routes } from "discord.js";
import type { Registry } from "./registry.js";

/**
 * Registers every slash command as one bulk overwrite: in the dev server when `guildId` is set,
 * otherwise globally. A server-only copy of a global command shows up twice in Discord, so global
 * registration also clears any left over from registering with this app's token and a dev server.
 * Returns what it did, one line each.
 */
export async function registerCommands(
  rest: REST,
  registry: Registry,
  applicationId: string,
  guildId?: string,
): Promise<string[]> {
  const body = [...registry.commands.values()].map(({ handler }) => handler.data.toJSON());
  const route = guildId
    ? Routes.applicationGuildCommands(applicationId, guildId)
    : Routes.applicationCommands(applicationId);
  await rest.put(route, { body });
  const done = [`Registered ${body.length} commands ${guildId ? "in the dev server" : "globally"}`];

  if (!guildId) {
    const guilds = (await rest.get(Routes.userGuilds())) as { id: string }[];
    for (const { id } of guilds) {
      const route = Routes.applicationGuildCommands(applicationId, id);
      const leftovers = (await rest.get(route)) as unknown[];
      if (leftovers.length === 0) continue;
      await rest.put(route, { body: [] });
      done.push(`Cleared ${leftovers.length} server-only commands from server ${id}`);
    }
  }
  return done;
}
