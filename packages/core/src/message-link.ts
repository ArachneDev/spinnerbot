import type { EventLocation } from "./events.js";

const LINK = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/;
const ID = /^\d{15,25}$/;

/**
 * Accepts a Discord message link, or a bare message ID found in the given channel.
 * Returns undefined when the text is neither.
 */
export function parseMessageRef(
  text: string,
  fallback: { guildId: string; channelId: string },
): EventLocation | undefined {
  const value = text.trim();
  const link = LINK.exec(value);
  if (link) return { guildId: link[1]!, channelId: link[2]!, messageId: link[3]! };
  if (ID.test(value)) return { ...fallback, messageId: value };
  return undefined;
}
