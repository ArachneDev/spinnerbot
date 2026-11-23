import {
  GatewayIntentBits,
  type Guild,
  type GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  type BaseMessageOptions,
} from "discord.js";
import type { Database } from "@scrimbot/db";
import { isStaff } from "../../framework/access.js";
import { defineCommand } from "../../framework/command.js";
import { UserFacingError } from "../../framework/errors.js";
import type { Feature, FeatureContext } from "../../framework/types.js";
import { steam, type SteamCheck } from "./steam.js";
import { allSteamLinks, linkSteamProfile, steamIdOf, steamIdsOf } from "./store.js";
import {
  FEATURE,
  FROM_COMMAND,
  joinMessage,
  linkedText,
  linkModal,
  linkPrompt,
  lobbyMessages,
  notJoinableMessage,
  profileInputId,
  steamLinkMessages,
  type PlayerStatus,
  type VoiceChannelView,
} from "./view.js";

const NOT_LINKED_INTRO =
  "Link your Steam profile so others can join your game. You can skip this for now, and you will be asked again next time.";

function statusFrom(check: SteamCheck): PlayerStatus {
  if (check.status !== "found") return { kind: "unknown" };
  const { lobby, gameName, isPrivate } = check.page;
  if (lobby) return { kind: "joinable", ...(gameName && { gameName }) };
  if (isPrivate) return { kind: "private" };
  return { kind: "idle", ...(gameName && { gameName }) };
}

/** Who sits in each voice channel the viewer may see, in the order Discord lists the channels. */
async function membersInVoice(guild: Guild, viewer: GuildMember) {
  const channels = new Map<string, { name: string; order: number[]; members: GuildMember[] }>();
  for (const state of guild.voiceStates.cache.values()) {
    const channel = state.channel;
    if (!channel?.permissionsFor(viewer).has(PermissionFlagsBits.ViewChannel)) continue;
    const member = state.member ?? (await guild.members.fetch(state.id).catch(() => null));
    if (!member) continue;
    const entry = channels.get(channel.id) ?? {
      name: channel.name,
      order: [channel.parent?.rawPosition ?? -1, channel.rawPosition],
      members: [],
    };
    entry.members.push(member);
    channels.set(channel.id, entry);
  }
  return [...channels.values()].sort(
    (a, b) => a.order[0]! - b.order[0]! || a.order[1]! - b.order[1]!,
  );
}

/** Builds the public list. It asks Steam about everyone linked, so it can take a while. */
async function buildLobbyMessages(
  guild: Guild,
  viewerId: string,
  db: Database,
): Promise<BaseMessageOptions[]> {
  const viewer = await guild.members.fetch(viewerId);
  const channels = await membersInVoice(guild, viewer);
  const linked = await steamIdsOf(
    db,
    channels.flatMap(({ members }) => members.map((member) => member.id)),
  );

  const views: VoiceChannelView[] = await Promise.all(
    channels.map(async ({ name, members }) => ({
      name,
      players: await Promise.all(
        // A music bot in voice has no Steam profile and would only clutter the list.
        members
          .filter((member) => !member.user.bot || linked.has(member.id))
          .map(async (member) => {
            const steamId = linked.get(member.id);
            return {
              userId: member.id,
              name: member.displayName,
              status: steamId
                ? statusFrom(await steam.check({ kind: "id", steamId }))
                : ({ kind: "unlinked" } as const),
            };
          }),
      ),
    })),
  );
  return lobbyMessages(views, viewerId);
}

/** What someone pressing a join button gets to see, freshly checked with Steam. */
async function joinAnswer(
  guild: Guild,
  targetUserId: string,
  { database: { db }, publicUrl }: FeatureContext,
): Promise<BaseMessageOptions> {
  const member = await guild.members.fetch(targetUserId).catch(() => null);
  const name = member?.displayName ?? "That player";
  const steamId = await steamIdOf(db, targetUserId);
  if (!steamId) return notJoinableMessage(`${name} no longer has a Steam profile linked.`);

  const check = await steam.check({ kind: "id", steamId });
  if (check.status !== "found") {
    return notJoinableMessage("Steam is not responding. Please try again in a minute.");
  }
  const { lobby, gameName } = check.page;
  if (!lobby) return notJoinableMessage(`${name} has no open lobby right now.`);
  return joinMessage(name, publicUrl, lobby, gameName);
}

export const joinLobbyFeature: Feature = {
  name: FEATURE,
  intents: [GatewayIntentBits.GuildVoiceStates],
  commands: [
    defineCommand({
      name: "join-lobby",
      description: "Show who is in voice, with buttons to join their game",
      // An unlinked user gets a modal, and that has to be the first response.
      defer: "none",
      async execute(interaction, _input, { database: { db } }) {
        if (!interaction.guild) return;
        if (!(await steamIdOf(db, interaction.user.id))) {
          await interaction.showModal(linkModal(FROM_COMMAND));
          return;
        }
        await interaction.deferReply();
        const [first, ...rest] = await buildLobbyMessages(
          interaction.guild,
          interaction.user.id,
          db,
        );
        await interaction.editReply(first!);
        for (const message of rest) await interaction.followUp(message);
      },
    }),
    defineCommand({
      name: "link-steam",
      description: "Link or change the Steam profile used by /join-lobby",
      options: {
        profile: {
          type: "string",
          description: "Your Steam profile link or friend code",
          required: true,
          maxLength: 200,
        },
      },
      async execute(interaction, input, { database: { db } }) {
        const page = await linkSteamProfile(db, steam, interaction.user.id, input.profile);
        await interaction.editReply(linkedText(page.isPrivate));
      },
    }),
    defineCommand({
      name: "steam-links",
      description: "List which Discord member is linked to which Steam profile",
      async execute(interaction, _input, { database: { db } }) {
        const [first, ...rest] = steamLinkMessages(await allSteamLinks(db));
        await interaction.editReply(first!);
        for (const message of rest) {
          await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
        }
      },
    }),
  ],
  components: [
    {
      // A press on a player's button in the public list.
      action: "join",
      async execute(interaction, [target = ""], context) {
        if (!interaction.isMessageComponent() || !interaction.guild) return;
        if (!(await steamIdOf(context.database.db, interaction.user.id))) {
          await interaction.reply({
            ...linkPrompt(target, NOT_LINKED_INTRO),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply(await joinAnswer(interaction.guild, target, context));
      },
    },
    {
      // Anyone may refresh, but it shows what the person who posted the list can see, since the
      // list is public and whoever presses might see channels they can't.
      action: "refresh",
      async execute(interaction, [owner = "", page = "0"], { database: { db } }) {
        if (!interaction.isMessageComponent() || !interaction.guild) return;
        if (!(await interaction.guild.members.fetch(owner).catch(() => null))) {
          throw new UserFacingError(
            "The person who posted this list has left the server. Run /join-lobby again.",
          );
        }
        await interaction.deferUpdate();
        const messages = await buildLobbyMessages(interaction.guild, owner, db);
        // A list that shrank has fewer pages, so the last one stands in.
        await interaction.editReply(messages[Math.min(Number(page), messages.length - 1)]!);
      },
    },
    {
      action: "delete",
      async execute(interaction, [owner = ""], { database: { db } }) {
        if (!interaction.isMessageComponent()) return;
        if (interaction.user.id !== owner && !(await isStaff(interaction, db))) {
          throw new UserFacingError(
            "Only the person who posted this list, or staff, can delete it.",
          );
        }
        await interaction.deferUpdate();
        await interaction.deleteReply();
      },
    },
    {
      action: "skip",
      async execute(interaction, [target = ""], context) {
        if (!interaction.isMessageComponent() || !interaction.guild) return;
        await interaction.deferUpdate();
        await interaction.editReply(await joinAnswer(interaction.guild, target, context));
      },
    },
    {
      action: "add",
      async execute(interaction, [target = FROM_COMMAND]) {
        if (!interaction.isMessageComponent()) return;
        await interaction.showModal(linkModal(target));
      },
    },
    {
      // The modal was sent. It came straight from the command, or from a prompt's button.
      action: "link",
      async execute(interaction, [target = FROM_COMMAND], context) {
        if (!interaction.isModalSubmit() || !interaction.guild) return;
        if (interaction.isFromMessage()) await interaction.deferUpdate();
        else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let linked: Awaited<ReturnType<typeof linkSteamProfile>>;
        try {
          linked = await linkSteamProfile(
            context.database.db,
            steam,
            interaction.user.id,
            interaction.fields.getTextInputValue(profileInputId),
          );
        } catch (error) {
          if (!(error instanceof UserFacingError)) throw error;
          // A modal can't reopen itself, so offer another go.
          await interaction.editReply(linkPrompt(target, error.message));
          return;
        }

        const confirmation = linkedText(linked.isPrivate);
        if (target !== FROM_COMMAND) {
          const answer = await joinAnswer(interaction.guild, target, context);
          await interaction.editReply({ ...answer, content: `${confirmation}\n${answer.content}` });
          return;
        }
        await interaction.editReply({ content: confirmation, components: [] });
        const messages = await buildLobbyMessages(
          interaction.guild,
          interaction.user.id,
          context.database.db,
        );
        for (const message of messages) await interaction.followUp(message);
      },
    },
  ],
};
