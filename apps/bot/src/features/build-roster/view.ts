import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  type EmbedBuilder,
  type APIEmbedField,
} from "discord.js";
import {
  buildRoster,
  CONFIRM_KEY,
  formatEmoji,
  listedPlayers,
  type AnswerEmoji,
  type AnswerOption,
  type Assignments,
  type StoredEvent,
} from "@scrimbot/core";
import {
  attached,
  attachedIfPresent,
  BANNER_FILE,
  brandedEmbed,
  brandFile,
  COLOURS,
  CREST_FILE,
  leaderEmblem,
  type BrandFile,
} from "../../framework/brand.js";
import { customId } from "../../framework/registry.js";
import { DEFAULT_DISPLAY, type RosterDisplay } from "./display.js";
import { previewRosterImage, renderRosterImage, ROSTER_IMAGE_FILE } from "./roster-image.js";

export const FEATURE = "build-roster";
const FIELD_LIMIT = 1024;

type Person = StoredEvent["responses"]["accepted"][number];

function clip(text: string): string {
  return text.length <= FIELD_LIMIT ? text : `${text.slice(0, FIELD_LIMIT - 4)}\n...`;
}

const list = (people: Person[]) =>
  clip(people.length === 0 ? "-" : people.map((p) => p.displayName).join("\n"));

const stamp = (event: StoredEvent) =>
  event.startsAt ? `<t:${Math.floor(new Date(event.startsAt).getTime() / 1000)}:F>` : undefined;

/** Step 1: what the bot understood from the source event. */
export function sourceEmbed(event: StoredEvent): EmbedBuilder {
  const { accepted, declined, tentative } = event.responses;
  const embed = brandedEmbed("ARACHNE // SIGN-UPS", {
    ...(event.complete ? {} : { notice: "Warning: the sign-up lists may be incomplete." }),
  })
    .setTitle(event.title)
    .addFields(
      { name: `Accepted · ${accepted.length}`, value: list(accepted), inline: true },
      { name: `Declined · ${declined.length}`, value: list(declined), inline: true },
      { name: `Tentative · ${tentative.length}`, value: list(tentative), inline: true },
    );
  const when = stamp(event);
  if (when) embed.setDescription(when);
  return embed;
}

/** Each player's chosen answer, by Discord user ID and answer key. */
export type Answers = ReadonlyMap<string, string>;

const PENDING_ICON = "⏳";
const BAR_CELLS = 10;

/** A small progress bar, in text because an embed can show nothing else. */
function progressBar(done: number, total: number): string {
  const filled = Math.round((done / total) * BAR_CELLS);
  return "▰".repeat(filled) + "▱".repeat(BAR_CELLS - filled);
}

const emojiText = (emoji: AnswerEmoji | null | undefined) => (emoji ? formatEmoji(emoji) : "");

/** Shown after Continue, because looking up every player can take a while. */
export function startingText(done = 0, total = 0): string {
  const progress =
    total > 0
      ? `\n\`${progressBar(done, total)}\` Matching players to Discord: ${done} of ${total}`
      : "";
  return `⏳ **Starting the roster builder...**${progress}`;
}

/** The public roster. Each listed player shows their answer, and the top carries the count. */
export function rosterEmbed(
  event: StoredEvent,
  assignments: Assignments,
  answers: Answers,
  options: AnswerOption[],
  {
    preview = false,
    display = DEFAULT_DISPLAY,
  }: { preview?: boolean; display?: RosterDisplay } = {},
): EmbedBuilder {
  const style = display.embedStyle;
  const roster = buildRoster(event, assignments, display);
  const listed = listedPlayers(roster);
  const chosen = (p: Person) => options.find((o) => o.key === answers.get(p.discordUserId ?? ""));
  const pending = emojiText(style.pendingEmoji) || PENDING_ICON;
  const emblem = emojiText(style.leaderEmoji) || leaderEmblem();
  const mark = (p: Person) => {
    const option = chosen(p);
    return option ? emojiText(option.emoji) || "•" : pending;
  };
  const name = (p: Person) => (p.discordUserId ? `<@${p.discordUserId}>` : p.displayName);

  const inline = style.layout !== "stacked";
  const fields: APIEmbedField[] = roster.squads
    .filter((squad) => squad.players.length > 0)
    .map((squad) => ({
      name: [
        `${emojiText(style.squadEmojis?.[squad.number - 1])} ${escapeMarkdown(squad.name.toUpperCase())}`.trim(),
        squad.players.length,
      ].join(" · "),
      value: clip(
        [
          ...(squad.type ? [`-# ${squad.type}`] : []),
          ...squad.players.map(
            (p) => `${mark(p)} ${name(p)}${p === squad.leader ? ` ${emblem}` : ""}`,
          ),
        ].join("\n"),
      ),
      inline,
    }));
  if (display.showBench && roster.bench.length > 0) {
    fields.push({
      name: `${style.benchName ?? "Bench"} · ${roster.bench.length}`,
      value: list(roster.bench),
      inline: false,
    });
  }

  const count = (key: string) => listed.filter((p) => chosen(p)?.key === key).length;
  const unanswered = listed.filter((p) => !chosen(p)).length;
  // The first answer is the Confirm one, so it is the one the headline counts.
  const others = [
    ...options.slice(1).map((o) => `${emojiText(o.emoji) || "•"} ${o.label}: ${count(o.key)}`),
    `${pending} Pending: ${unanswered}`,
  ];
  const confirmed = count(CONFIRM_KEY);
  const bar =
    style.showProgress !== false && listed.length > 0
      ? ` \`${progressBar(confirmed, listed.length)}\``
      : "";
  const when = style.showTime !== false ? stamp(event) : undefined;
  const lines = [
    style.description && `${style.description}\n`,
    when,
    `**Confirmed ${confirmed}/${listed.length}**${bar}`,
    others.join(" · "),
    preview
      ? `-# Placed ${listed.length} of ${event.responses.accepted.length}`
      : "-# Listed players: answer with the buttons below.",
  ];

  const heading = style.heading ?? "ARACHNE // ROSTER";
  const colour = style.colour
    ? Number.parseInt(style.colour.slice(1), 16)
    : listed.length > 0 && roster.bench.length === 0
      ? COLOURS.win
      : COLOURS.primary;
  const embed = brandedEmbed(preview ? `PREVIEW // ${heading}` : heading, {
    colour,
    icon: attachedIfPresent(CREST_FILE),
    ...(style.footer ? { footer: style.footer } : {}),
    ...(listed.some((p) => !p.discordUserId)
      ? { notice: "Players shown by name could not be matched to a Discord user." }
      : {}),
  })
    .setTitle(style.title ?? event.title)
    .setDescription(lines.filter(Boolean).join("\n"))
    .addFields(fields);
  if (display.showBanner) {
    if (style.bannerImage === "roster") {
      if (listed.length > 0) embed.setImage(attached(ROSTER_IMAGE_FILE));
    } else {
      const banner = style.bannerUrl ?? attachedIfPresent(BANNER_FILE);
      if (banner) embed.setImage(banner);
    }
  }
  if (style.thumbnail) {
    const thumbnail = style.thumbnail === "crest" ? attachedIfPresent(CREST_FILE) : style.thumbnail;
    if (thumbnail) embed.setThumbnail(thumbnail);
  }
  return embed;
}

/** For a live preview: show the last picture drawn, and redraw the preview when a newer one is. */
export interface LivePreview {
  id: string;
  onImageReady: () => void;
}

/** The pictures a roster embed refers to, to send with it. */
export async function rosterFiles(
  event: StoredEvent,
  assignments: Assignments,
  display: RosterDisplay,
  live?: LivePreview,
): Promise<BrandFile[]> {
  const files = [brandFile(CREST_FILE)].filter((file) => file !== undefined);
  if (!display.showBanner) return files;
  if (display.embedStyle.bannerImage === "roster") {
    // The picture is for show, so failing to draw it must not stop a roster being posted.
    const failed = (error: unknown) => {
      console.error("Could not draw the roster image", error);
      return null;
    };
    const image = live
      ? previewRosterImage(live.id, event, assignments, display, live.onImageReady, failed)
      : await renderRosterImage(event, assignments, display).catch(failed);
    if (image) files.push({ name: ROSTER_IMAGE_FILE, attachment: image });
  } else if (!display.embedStyle.bannerUrl) {
    const banner = brandFile(BANNER_FILE);
    if (banner) files.push(banner);
  }
  return files;
}

const optionEmoji = (option: AnswerOption) =>
  option.emoji && "id" in option.emoji
    ? {
        id: option.emoji.id,
        name: option.emoji.name,
        ...(option.emoji.animated ? { animated: true } : {}),
      }
    : option.emoji?.name;

/** The answer buttons as they will look, for the preview. They can't be pressed there. */
export function previewAnswers(options: AnswerOption[]) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...options.map((option, index) => {
      const answer = new ButtonBuilder()
        .setCustomId(customId(FEATURE, "preview-answer", String(index)))
        .setLabel(option.label)
        .setStyle(index === 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(true);
      const emoji = optionEmoji(option);
      return emoji ? answer.setEmoji(emoji) : answer;
    }),
  );
}

/** Under the posted roster: a row of answers for players, then one button for the leader. */
export const postedComponents = (id: string, options: AnswerOption[]) => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...options.map((option, index) => {
      const answer = new ButtonBuilder()
        .setCustomId(customId(FEATURE, "answer", id, option.key))
        .setLabel(option.label)
        .setStyle(index === 0 ? ButtonStyle.Success : ButtonStyle.Secondary);
      const emoji = optionEmoji(option);
      return emoji ? answer.setEmoji(emoji) : answer;
    }),
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(FEATURE, "manage", id))
      .setLabel("Manage")
      .setEmoji("⚙️")
      .setStyle(ButtonStyle.Secondary),
  ),
];

/** What Manage opens, privately, for the roster's creator. */
export const managePanel = (id: string) => ({
  content:
    "**Manage this roster**\nEdit the squads and answers, remind players who haven't answered, or delete the roster for everyone.",
  components: [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(FEATURE, "edit", id))
        .setLabel("Edit roster")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(customId(FEATURE, "ping-ask", id))
        .setLabel("Ping pending")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(customId(FEATURE, "delete", id))
        .setLabel("Delete")
        .setStyle(ButtonStyle.Danger),
    ),
  ],
});

export const buttons = (...parts: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(...parts);

export const button = (label: string, style: ButtonStyle, action: string, ...args: string[]) =>
  new ButtonBuilder()
    .setCustomId(customId(FEATURE, action, ...args))
    .setLabel(label)
    .setStyle(style);
