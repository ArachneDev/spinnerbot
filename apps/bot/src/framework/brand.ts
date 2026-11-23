import { EmbedBuilder, type Client } from "discord.js";
import { readAsset } from "./assets.js";

/** Arachne's colours as Discord takes them. The sidebar is the only colour an embed can show. */
export const COLOURS = { primary: 0xe3121e, win: 0x61bd67 } as const;

const FOOTER = "[RCNE] // WEAVE THE WEB // WAGE THE WAR";
const LEADER_EMOJI_NAME = "squad_leader";
/** The yellow crown, until the bot has its own emblem emoji or if it can't be found. */
const LEADER_FALLBACK = "👑";

export const CREST_FILE = "arachne-crest.png";
export const BANNER_FILE = "arachne-banner.webp";

export interface BrandFile {
  name: string;
  attachment: Buffer;
}

/** Sent with the message, so these work on any address, including a local dev one. */
export function brandFile(name: string): BrandFile | undefined {
  const attachment = readAsset(name);
  return attachment && { name, attachment };
}

export const attached = (name: string): string => `attachment://${name}`;

/** `attachment://` for a brand file that exists, and nothing for one that is missing. */
export const attachedIfPresent = (name: string): string | undefined =>
  readAsset(name) ? attached(name) : undefined;

let iconUrl: string | undefined;
let leaderMark = LEADER_FALLBACK;

/** Emoji IDs differ between the dev and production apps, so the emblem is looked up by name. */
export async function loadBrand(client: Client<true>): Promise<void> {
  iconUrl = client.user.displayAvatarURL({ extension: "png", size: 128 });
  const emojis = await client.application.emojis.fetch();
  const emoji = emojis.find((candidate) => candidate.name === LEADER_EMOJI_NAME);
  leaderMark = emoji ? emoji.toString() : LEADER_FALLBACK;
}

export const leaderEmblem = (): string => leaderMark;

/** An embed with Arachne's header and footer. A notice goes in the footer, before the clan tag. */
export function brandedEmbed(
  section: string,
  {
    colour = COLOURS.primary,
    notice,
    footer = FOOTER,
    icon = iconUrl,
  }: { colour?: number; notice?: string; footer?: string; icon?: string | undefined } = {},
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(colour)
    .setAuthor({ name: section, ...(icon ? { iconURL: icon } : {}) })
    .setFooter({ text: notice ? `${notice} · ${footer}` : footer });
}
