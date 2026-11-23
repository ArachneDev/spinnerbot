import type { Client, Guild } from "discord.js";
import {
  parseApolloMessage,
  parseMessageRef,
  toStoredEvent,
  type EventLocation,
  type StoredEvent,
} from "@scrimbot/core";
import { UserFacingError } from "../../framework/errors.js";

export function locate(text: string, guildId: string, channelId: string): EventLocation {
  const location = parseMessageRef(text, { guildId, channelId });
  if (!location) throw new UserFacingError("Enter a message link or message ID for the event.");
  if (location.guildId !== guildId)
    throw new UserFacingError("That event belongs to a different server.");
  return location;
}

/** Reads the Apollo message and turns it into the snapshot we store. */
export async function readEvent(client: Client, location: EventLocation): Promise<StoredEvent> {
  const channel = await client.channels.fetch(location.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new UserFacingError(
      "Spinner Bot can't view that channel. Grant it the View Channel permission and try again.",
    );
  }
  // The bot doesn't receive message events, so a cached copy never learns about new sign-ups.
  const message = await channel.messages
    .fetch({ message: location.messageId, force: true })
    .catch(() => null);
  if (!message) throw new UserFacingError("That message could not be found.");
  try {
    return toStoredEvent(parseApolloMessage({ embeds: message.embeds.map((e) => e.toJSON()) }));
  } catch {
    throw new UserFacingError("That message is not an Apollo event.");
  }
}

const normalize = (text: string | null | undefined) => text?.trim().toLowerCase();

/**
 * Apollo lists display names, not IDs, so we look each one up in the server. A name only counts
 * when exactly one member matches, because guessing would ping the wrong person.
 */
export async function matchMembers(
  guild: Guild,
  event: StoredEvent,
  onProgress?: (done: number, total: number) => void,
): Promise<StoredEvent> {
  const cache = new Map<string, string | undefined>();
  async function find(name: string): Promise<string | undefined> {
    const key = normalize(name)!;
    if (cache.has(key)) return cache.get(key);
    const found = await guild.members.search({ query: name, limit: 10 }).catch(() => undefined);
    const matches = [...(found?.values() ?? [])].filter((m) =>
      [m.displayName, m.nickname, m.user.globalName, m.user.username].some(
        (candidate) => normalize(candidate) === key,
      ),
    );
    const id = matches.length === 1 ? matches[0]!.id : undefined;
    cache.set(key, id);
    return id;
  }

  const accepted = [];
  for (const player of event.responses.accepted) {
    const id = await find(player.displayName);
    accepted.push(id ? { ...player, discordUserId: id } : player);
    onProgress?.(accepted.length, event.responses.accepted.length);
  }
  return { ...event, responses: { ...event.responses, accepted } };
}
