import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  type APIEmbedField,
  type BaseMessageOptions,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { steamProfileUrl, type SteamLobby } from "@scrimbot/core";
import { brandedEmbed } from "../../framework/brand.js";
import { customId } from "../../framework/registry.js";

export const FEATURE = "join-lobby";
/** Stands in for "no player" in a customId: the person was linking from the command, not a button. */
export const FROM_COMMAND = "command";

const BUTTONS_PER_ROW = 5;
/** Discord allows 5 rows, and the last holds Refresh and Delete. */
const ROWS_PER_MESSAGE = 4;
const FIELDS_PER_EMBED = 25;
const FIELD_VALUE_LIMIT = 1024;
const FIELD_NAME_LIMIT = 256;
const BUTTON_LABEL_LIMIT = 80;
/** Discord's limit for all of an embed is 6000. This leaves room for the title and footer. */
const EMBED_TEXT_LIMIT = 5500;
const DESCRIPTION_LIMIT = 4096;
const PROFILE_INPUT = "profile";

export type PlayerStatus =
  /** In a lobby that can be joined. */
  | { kind: "joinable"; gameName?: string }
  /** Steam answered, and there is nothing to join. */
  | { kind: "idle"; gameName?: string }
  | { kind: "private" }
  /** Steam didn't answer. A press checks again, so this one still gets a button. */
  | { kind: "unknown" }
  | { kind: "unlinked" };

export interface VoicePlayer {
  userId: string;
  name: string;
  status: PlayerStatus;
}

export interface VoiceChannelView {
  name: string;
  players: VoicePlayer[];
}

const hasButton = ({ status }: VoicePlayer) =>
  status.kind === "joinable" || status.kind === "unknown";

function statusText(status: PlayerStatus): string {
  switch (status.kind) {
    case "joinable":
      return status.gameName ? `Joinable in ${escapeMarkdown(status.gameName)}` : "Joinable";
    case "idle":
      return status.gameName
        ? `In ${escapeMarkdown(status.gameName)}, no open lobby`
        : "No open lobby";
    case "private":
      return "Steam profile is private";
    case "unknown":
      return "Steam did not respond. Press to check again";
    case "unlinked":
      return "No Steam profile linked";
  }
}

const STATUS_ICON: Record<PlayerStatus["kind"], string> = {
  joinable: "🟢",
  idle: "⚪",
  private: "🔒",
  unknown: "⚠️",
  unlinked: "❔",
};

const playerLine = ({ name, status }: VoicePlayer) =>
  `${STATUS_ICON[status.kind]} **${escapeMarkdown(name)}**: ${statusText(status)}`;

function joinButton(player: VoicePlayer): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId(FEATURE, "join", player.userId))
    .setLabel(`Join ${player.name}`.slice(0, BUTTON_LABEL_LIMIT))
    .setStyle(player.status.kind === "joinable" ? ButtonStyle.Success : ButtonStyle.Secondary);
}

/** Those who can be joined come first, so the buttons and the list read in the same order. */
const STATUS_ORDER: PlayerStatus["kind"][] = ["joinable", "unknown", "idle", "private", "unlinked"];

function inDisplayOrder(players: VoicePlayer[]): VoicePlayer[] {
  return [...players].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status.kind) - STATUS_ORDER.indexOf(b.status.kind) ||
      a.name.localeCompare(b.name),
  );
}

interface Page {
  fields: APIEmbedField[];
  rows: ButtonBuilder[][];
  textLength: number;
}

const emptyPage = (): Page => ({ fields: [], rows: [], textLength: 0 });

function paginate(channels: VoiceChannelView[]): Page[] {
  const pages: Page[] = [emptyPage()];
  const page = () => pages[pages.length - 1]!;

  for (const channel of channels) {
    const fieldName = channel.name.slice(0, FIELD_NAME_LIMIT - 12);
    // Each channel starts its own field and its own row of buttons.
    let field: APIEmbedField | undefined;
    let row: ButtonBuilder[] | undefined;
    let started = false;

    for (const player of inDisplayOrder(channel.players)) {
      const line = playerLine(player);
      const needsRow = hasButton(player) && (!row || row.length === BUTTONS_PER_ROW);
      const needsField = !field || field.value.length + line.length + 1 > FIELD_VALUE_LIMIT;

      const fits =
        (!needsRow || page().rows.length < ROWS_PER_MESSAGE) &&
        (!needsField || page().fields.length < FIELDS_PER_EMBED) &&
        page().textLength + line.length + fieldName.length + 12 < EMBED_TEXT_LIMIT;
      if (!fits) {
        pages.push(emptyPage());
        field = undefined;
        row = undefined;
      }

      if (!field || needsField) {
        field = { name: started ? `${fieldName} (continued)` : fieldName, value: "" };
        started = true;
        page().fields.push(field);
        page().textLength += field.name.length;
      }
      field.value = field.value ? `${field.value}\n${line}` : line;
      page().textLength += line.length + 1;

      if (hasButton(player)) {
        if (!row || row.length === BUTTONS_PER_ROW) {
          row = [];
          page().rows.push(row);
        }
        row.push(joinButton(player));
      }
    }
  }
  return pages;
}

function controlRow(ownerId: string, pageIndex: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(FEATURE, "refresh", ownerId, String(pageIndex)))
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(customId(FEATURE, "delete", ownerId))
      .setLabel("Delete")
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * The public list, in as many messages as Discord's limits on buttons and embeds require.
 * `ownerId` is who it was built for: a refresh keeps to the channels that person can see.
 */
export function lobbyMessages(channels: VoiceChannelView[], ownerId: string): BaseMessageOptions[] {
  const pages = paginate(channels.filter((channel) => channel.players.length > 0));
  return pages.map((page, index) => {
    const embed = brandedEmbed("ARACHNE // LOBBY")
      .setTitle(pages.length > 1 ? `Join game (${index + 1}/${pages.length})` : "Join game")
      .setTimestamp(new Date());
    if (page.fields.length > 0) embed.addFields(page.fields);
    else embed.setDescription("No one is in a voice channel you can view.");
    return {
      embeds: [embed],
      components: [
        ...page.rows.map((row) => new ActionRowBuilder<ButtonBuilder>().addComponents(row)),
        controlRow(ownerId, index),
      ],
      allowedMentions: { parse: [] },
    };
  });
}

/** Where to send the person pressing a link button. Discord refuses steam:// links on buttons. */
export function joinPageUrl(publicUrl: string, lobby: SteamLobby): string {
  return `${publicUrl}/api/join-lobby/${lobby.appId}/${lobby.lobbyId}/${lobby.steamId}`;
}

/** The private answer to a press, once Steam has confirmed the lobby is still there. */
export function joinMessage(
  name: string,
  publicUrl: string,
  lobby: SteamLobby,
  gameName?: string,
): BaseMessageOptions {
  const game = gameName ? ` in **${escapeMarkdown(gameName)}**` : "";
  return {
    content: `**${escapeMarkdown(name)}** has an open lobby${game}.`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Join game")
          .setURL(joinPageUrl(publicUrl, lobby)),
      ),
    ],
  };
}

export function notJoinableMessage(text: string): BaseMessageOptions {
  return { content: text, components: [] };
}

/**
 * The private prompt to link a profile. `target` is the player the person wanted to join, and only
 * then can they skip. From the command there is nothing to skip to.
 */
export function linkPrompt(target: string, intro: string): BaseMessageOptions {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(customId(FEATURE, "add", target))
      .setLabel("Add Steam profile")
      .setStyle(ButtonStyle.Primary),
  ];
  if (target !== FROM_COMMAND) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(customId(FEATURE, "skip", target))
        .setLabel("Skip for now")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return {
    content: intro,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
  };
}

export function linkModal(target: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(FEATURE, "link", target))
    .setTitle("Link your Steam profile")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Your Steam profile link or friend code")
        .setDescription("Your profile must be public for others to join you.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(PROFILE_INPUT)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("https://steamcommunity.com/id/yourname/")
            .setMaxLength(200)
            .setRequired(true),
        ),
    );
}

export const profileInputId = PROFILE_INPUT;

/** What to tell someone who just linked a profile. */
export function linkedText(isPrivate: boolean): string {
  return isPrivate
    ? "Steam profile linked. It is private, so others can't join you until your profile and game details are public."
    : "Steam profile linked.";
}

/** The whole mapping for staff, over several messages if needed. Mentions in embeds don't ping. */
export function steamLinkMessages(
  links: { discordUserId: string; steamId: string }[],
): BaseMessageOptions[] {
  if (links.length === 0) return [{ content: "No Steam profiles are linked yet." }];
  const pages: string[] = [];
  let page = "";
  for (const { discordUserId, steamId } of links) {
    const url = steamProfileUrl({ kind: "id", steamId });
    const line = `<@${discordUserId}> [${steamId}](${url})`;
    if (page.length + line.length + 1 > DESCRIPTION_LIMIT) {
      pages.push(page);
      page = "";
    }
    page += `${page && "\n"}${line}`;
  }
  pages.push(page);
  return pages.map((description, index) => ({
    embeds: [
      brandedEmbed("ARACHNE // STEAM LINKS")
        .setTitle(
          `Steam links: ${links.length}${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ""}`,
        )
        .setDescription(description),
    ],
  }));
}
