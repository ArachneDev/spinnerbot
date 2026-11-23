import { randomBytes } from "node:crypto";
import {
  ButtonStyle,
  DiscordAPIError,
  escapeMarkdown,
  MessageFlags,
  type Client,
  type MessageComponentInteraction,
} from "discord.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  answerOptionsSchema,
  assignmentsSchema,
  buildRoster,
  CONFIRM_KEY,
  embedStyleSchema,
  listedPlayers,
  squadNamesSchema,
  storedEventSchema,
} from "@scrimbot/core";
import { schema, type Database } from "@scrimbot/db";
import { defineCommand } from "../../framework/command.js";
import { finish } from "../../framework/dismiss.js";
import { UserFacingError } from "../../framework/errors.js";
import { defineJob, type Feature } from "../../framework/types.js";
import { draftDisplay, postedDisplay } from "./display.js";
import {
  forgetPingCooldown,
  pendingPlayers,
  pingAllowedAt,
  sendPing,
  startPingCooldown,
  threadProblem,
} from "./ping.js";
import { assertCanPost, CANT_POST_HERE, postFailure } from "./posting.js";
import { draftMessage, forgetPreview, refreshPreview } from "./preview.js";
import { readEvent, locate, matchMembers } from "./source.js";
import { createThrottle } from "./throttle.js";
import { refreshEmojis } from "./emojis.js";
import {
  button,
  buttons,
  FEATURE,
  managePanel,
  postedComponents,
  rosterEmbed,
  rosterFiles,
  sourceEmbed,
  startingText,
  type Answers,
} from "./view.js";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const POSTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COUNTER_GAP_MS = 2000;
const PROGRESS_GAP_MS = 2000;
const { guildRosterDefaults: defaults, rosterInstances: table } = schema;
type Instance = typeof table.$inferSelect;

/** Pressed in the private Manage panel, a button replaces it. On an old roster, it answers apart. */
const fromPanel = (interaction: MessageComponentInteraction) =>
  interaction.message.flags.has(MessageFlags.Ephemeral);

/** Who on a posted roster hasn't answered, from what players see rather than an edit in progress. */
async function pendingOn(db: Database, row: Instance) {
  return pendingPlayers(
    storedEventSchema.parse(row.snapshot),
    assignmentsSchema.parse(row.postedAssignments ?? row.assignments),
    await loadAnswers(db, row.id),
    postedOptions(row),
  );
}

/** A posted roster the owner may ping, or why they can't right now. */
async function pingableInstance(db: Database, id: string, userId: string) {
  const row = await ownedInstance(db, id, userId);
  if (row.status === "draft" || !row.postedMessageId) {
    throw new UserFacingError("This roster hasn't been posted yet.");
  }
  const allowedAt = pingAllowedAt(id);
  if (allowedAt) {
    throw new UserFacingError(
      `Pending players were pinged recently. You can ping again <t:${Math.ceil(allowedAt.getTime() / 1000)}:R>.`,
    );
  }
  return row;
}

const NAMES_LIMIT = 1500;
const players = (count: number, one: string, many: string) =>
  count === 1 ? `1 player ${one}` : `${count} players ${many}`;

/**
 * Tells the web app this roster changed, so anyone on its page loads it again, or stops if it was
 * posted or deleted. The page still works without it, by polling, so a failure is only logged.
 */
async function notifyWeb(db: Database, id: string, log: { warn: (o: object, m: string) => void }) {
  await db
    .execute(sql`select pg_notify(${ROSTER_CHANNEL}, ${id})`)
    .catch((error: unknown) =>
      log.warn({ err: error, roster: id }, "Could not notify the web app"),
    );
}
/** Must match ROSTER_CHANNEL in the web app's roster feature. */
const ROSTER_CHANNEL = "roster_changed";

/** Loads an instance the user owns, or explains why they can't have it. */
async function ownedInstance(db: Database, id: string, userId: string) {
  const [row] = await db.select().from(table).where(eq(table.id, id));
  if (!row || row.expiresAt < new Date()) {
    throw new UserFacingError("This roster has expired or been deleted.");
  }
  if (row.ownerId !== userId) throw new UserFacingError("Only the roster's creator can do this.");
  return row;
}

async function fetchMessage(client: Client, channelId: string, messageId: string) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased()
    ? channel.messages.fetch({ message: messageId, force: true }).catch(() => null)
    : null;
}

/** The buttons under the sign-ups. They are disabled while the roster builder starts. */
const sourceButtons = (channelId: string, messageId: string, starting = false) =>
  buttons(
    button(
      starting ? "Starting..." : "Continue",
      ButtonStyle.Primary,
      "continue",
      channelId,
      messageId,
    ).setDisabled(starting),
    button("Cancel", ButtonStyle.Secondary, "cancel").setDisabled(starting),
  );

const { rosterResponses: responses } = schema;

/** Everyone's answers for one roster, by Discord user ID. */
async function loadAnswers(db: Database, instanceId: string): Promise<Answers> {
  const rows = await db.select().from(responses).where(eq(responses.instanceId, instanceId));
  return new Map(rows.map((r) => [r.userId, r.answer]));
}

/** The buttons players currently see. A roster being edited may already hold newer ones. */
const postedOptions = (row: Instance) =>
  answerOptionsSchema.parse(row.postedAnswerOptions ?? row.answerOptions);

// Answers often arrive in bursts, for example when everyone responds to a fresh roster. The
// message is redrawn at most once per gap, from the answers stored at that moment.
const counterThrottle = createThrottle(COUNTER_GAP_MS);

/** Reads the row again, because the roster may have been edited since the answer arrived. */
async function redrawCounterById(client: Client, db: Database, id: string): Promise<void> {
  const [row] = await db.select().from(table).where(eq(table.id, id));
  if (row) await redrawCounter(client, db, row);
}

async function redrawCounter(client: Client, db: Database, row: Instance): Promise<void> {
  const message = row.postedMessageId
    ? await fetchMessage(client, row.channelId, row.postedMessageId)
    : null;
  if (!message) return;
  const display = postedDisplay(row);
  const event = storedEventSchema.parse(row.snapshot);
  const assignments = assignmentsSchema.parse(row.postedAssignments ?? row.assignments);
  const embed = rosterEmbed(event, assignments, await loadAnswers(db, row.id), postedOptions(row), {
    display,
  });
  // Naming the files already on the message keeps them inside the embed. Discord's own links to
  // them would show them as separate images. A roster from before they were attached needs them sent.
  const hasFiles = Boolean(message.embeds[0]?.author?.iconURL);
  await message.edit({
    embeds: [embed],
    ...(hasFiles ? {} : { files: await rosterFiles(event, assignments, display), attachments: [] }),
  });
}

export const buildRosterFeature: Feature = {
  name: FEATURE,
  commands: [
    defineCommand({
      name: "build-roster",
      description: "Build a scrim roster from an Apollo event",
      options: {
        event: {
          type: "string",
          description: "Link or ID of the Apollo event message",
          required: true,
        },
      },
      async execute(interaction, input, { client }) {
        const location = locate(input.event, interaction.guildId ?? "", interaction.channelId);
        const event = await readEvent(client, location);
        await interaction.editReply({
          embeds: [sourceEmbed(event)],
          components: [sourceButtons(location.channelId, location.messageId)],
        });
      },
    }),
  ],
  components: [
    {
      action: "continue",
      async execute(
        interaction,
        [channelId = "", messageId = ""],
        { client, database, publicUrl },
      ) {
        if (!interaction.isMessageComponent() || !interaction.guild) return;
        // Better to learn this now than after building the whole roster.
        assertCanPost(interaction);
        await interaction.update({
          content: startingText(),
          components: [sourceButtons(channelId, messageId, true)],
        });

        const location = { guildId: interaction.guild.id, channelId, messageId };
        try {
          let shownAt = Date.now();
          const event = await matchMembers(
            interaction.guild,
            await readEvent(client, location),
            (done, total) => {
              if (Date.now() - shownAt < PROGRESS_GAP_MS) return;
              shownAt = Date.now();
              // Only a progress display, so a failed edit changes nothing.
              void interaction.editReply({ content: startingText(done, total) }).catch(() => {});
            },
          );
          const token = randomBytes(24).toString("base64url");
          const [saved] = await database.db
            .select({ squadNames: defaults.squadNames, embedStyle: defaults.embedStyle })
            .from(defaults)
            .where(eq(defaults.guildId, location.guildId));
          const [row] = await database.db
            .insert(table)
            .values({
              token,
              guildId: location.guildId,
              channelId: interaction.channelId,
              ownerId: interaction.user.id,
              sourceChannelId: channelId,
              sourceMessageId: messageId,
              snapshot: event,
              ...(saved
                ? {
                    squadNames: squadNamesSchema.parse(saved.squadNames),
                    embedStyle: embedStyleSchema.parse(saved.embedStyle ?? {}),
                  }
                : {}),
              previewToken: interaction.token,
              previewTokenAt: new Date(),
              expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
            })
            .returning();
          await interaction.editReply(await draftMessage(row!, publicUrl));
        } catch (error) {
          // Don't leave it looking busy. The router then says what went wrong.
          await interaction
            .editReply({ content: "", components: [sourceButtons(channelId, messageId)] })
            .catch(() => {});
          throw error;
        }
      },
    },
    {
      action: "refresh",
      async execute(interaction, [id = ""], { database: { db }, publicUrl }) {
        if (!interaction.isMessageComponent()) return;
        await interaction.deferUpdate();
        await ownedInstance(db, id, interaction.user.id);
        // This click carries a fresh token, so the live preview can run for another 15 minutes.
        const [row] = await db
          .update(table)
          .set({ previewToken: interaction.token, previewTokenAt: new Date() })
          .where(eq(table.id, id))
          .returning();
        await interaction.editReply(await draftMessage(row!, publicUrl));
      },
    },
    {
      action: "post",
      async execute(interaction, [id = ""], { database: { db }, client, log }) {
        if (!interaction.isMessageComponent()) return;
        await interaction.deferUpdate();

        const row = await ownedInstance(db, id, interaction.user.id);
        if (row.status === "posted")
          throw new UserFacingError("This roster has already been posted.");
        const event = storedEventSchema.parse(row.snapshot);
        const assignments = assignmentsSchema.parse(row.assignments);
        const options = answerOptionsSchema.parse(row.answerOptions);
        const display = draftDisplay(row);
        const embed = rosterEmbed(event, assignments, new Map(), options, { display });
        if (listedPlayers(buildRoster(event, assignments)).length === 0) {
          throw new UserFacingError(
            "No players have been placed. Use the link to assign them to squads.",
          );
        }

        assertCanPost(interaction);

        // An update keeps the posted message, and everyone's answers, and only redraws it.
        const existing =
          row.status === "editing" && row.postedMessageId
            ? await fetchMessage(client, row.channelId, row.postedMessageId)
            : null;
        let messageId: string;
        try {
          if (existing) {
            await existing.edit({
              embeds: [
                rosterEmbed(event, assignments, await loadAnswers(db, id), options, { display }),
              ],
              components: postedComponents(id, options),
              files: await rosterFiles(event, assignments, display),
              attachments: [],
            });
            messageId = existing.id;
          } else {
            const channel = interaction.channel;
            if (!channel?.isSendable()) throw new UserFacingError(CANT_POST_HERE);
            const message = await channel.send({
              embeds: [embed],
              components: postedComponents(id, options),
              files: await rosterFiles(event, assignments, display),
            });
            messageId = message.id;
          }
        } catch (error) {
          if (error instanceof DiscordAPIError) {
            log.warn(
              { roster: id, code: error.code, status: error.status },
              "Discord refused the roster",
            );
          }
          throw postFailure(error);
        }

        // The status check makes a double click post only once.
        await db
          .update(table)
          .set({
            status: "posted",
            postedMessageId: messageId,
            postedAssignments: assignments,
            postedAnswerOptions: options,
            postedSquadNames: display.squadNames,
            postedSquadLeaders: display.squadLeaders,
            postedShowBanner: display.showBanner,
            postedShowBench: display.showBench,
            postedEmbedStyle: display.embedStyle,
            previewToken: null,
            previewTokenAt: null,
            expiresAt: new Date(Date.now() + POSTED_TTL_MS),
          })
          .where(and(eq(table.id, id), inArray(table.status, ["draft", "editing"])));
        forgetPreview(id);
        await notifyWeb(db, id, log);
        await finish(
          interaction,
          existing
            ? "Roster updated. Use **Manage** under it to edit it, ping players or delete it."
            : "Roster posted. Use **Manage** under it to edit it, ping players or delete it.",
        );
      },
    },
    {
      // Everyone sees this one button, and only the creator gets anything from it.
      action: "manage",
      async execute(interaction, [id = ""], { database: { db } }) {
        if (!interaction.isMessageComponent()) return;
        await ownedInstance(db, id, interaction.user.id);
        await interaction.reply({ ...managePanel(id), flags: MessageFlags.Ephemeral });
      },
    },
    {
      // Only asks. Nothing is sent until the owner confirms.
      action: "ping-ask",
      async execute(interaction, [id = ""], { database: { db } }) {
        if (!interaction.isMessageComponent()) return;
        const row = await pingableInstance(db, id, interaction.user.id);
        const { pingable, unmatched } = await pendingOn(db, row);
        if (pingable.length === 0) {
          await finish(
            interaction,
            unmatched.length === 0
              ? "Everyone listed has answered. Nothing was sent."
              : "Nobody can be pinged: no one who still has to answer was matched to a Discord user. Nothing was sent.",
          );
          return;
        }
        const names = pingable.map((p) => escapeMarkdown(p.displayName)).join(", ");
        const problem = threadProblem(interaction);
        const lines = [
          `**Ping ${players(pingable.length, "who hasn't", "who haven't")} answered?**`,
          names.length > NAMES_LIMIT ? `${names.slice(0, NAMES_LIMIT)}...` : names,
        ];
        if (unmatched.length > 0) {
          lines.push(
            `-# ${players(unmatched.length, "hasn't", "haven't")} answered too, but can't be pinged because they weren't matched to a Discord user.`,
          );
        }
        if (problem) lines.push(`-# ${problem}`);
        await interaction.update({
          content: lines.join("\n"),
          components: [
            buttons(
              button("Ping", ButtonStyle.Primary, "ping", id),
              button("Cancel", ButtonStyle.Secondary, "keep"),
            ),
          ],
          allowedMentions: { parse: [] },
        });
      },
    },
    {
      action: "ping",
      async execute(interaction, [id = ""], { database: { db }, client, log }) {
        if (!interaction.isMessageComponent()) return;
        const row = await pingableInstance(db, id, interaction.user.id);
        // Answers may have arrived while the owner was reading the confirmation.
        const { pingable } = await pendingOn(db, row);
        if (pingable.length === 0) {
          await finish(interaction, "Everyone listed has answered since. Nothing was sent.");
          return;
        }
        // Started before anything slow, so a double click pings once.
        startPingCooldown(id);
        try {
          await interaction.deferUpdate();
          const roster = await fetchMessage(client, row.channelId, row.postedMessageId!);
          if (!roster) throw new UserFacingError("The posted roster no longer exists.");
          const sent = await sendPing(
            roster,
            pingable.map((p) => p.discordUserId),
            !threadProblem(interaction),
          );
          const count = pingable.length === 1 ? "1 player" : `${pingable.length} players`;
          await finish(
            interaction,
            sent.inThread
              ? `Pinged ${count} in the [roster's thread](${sent.url}).`
              : `Pinged ${count} in a [reply to the roster](${sent.url}).`,
          );
        } catch (error) {
          forgetPingCooldown(id);
          if (!(error instanceof DiscordAPIError)) throw error;
          log.warn(
            { roster: id, code: error.code, status: error.status },
            "Discord refused the ping",
          );
          throw new UserFacingError(
            [50001, 50013].includes(Number(error.code))
              ? "Spinner Bot isn't allowed to send the ping here. Check its thread and message permissions in this channel."
              : `Discord refused the ping (error ${error.code}). Nothing more was sent.`,
          );
        }
      },
    },
    {
      action: "edit",
      async execute(interaction, [id = ""], { database: { db }, publicUrl, log }) {
        if (!interaction.isMessageComponent()) return;
        const row = await ownedInstance(db, id, interaction.user.id);
        if (row.status === "draft")
          throw new UserFacingError("This roster hasn't been posted yet.");
        // The posted message stays as it is until the leader presses Update roster.
        const [editing] = await db
          .update(table)
          .set({
            status: "editing",
            previewToken: interaction.token,
            previewTokenAt: new Date(),
            expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
          })
          .where(eq(table.id, id))
          .returning();
        await notifyWeb(db, id, log);
        const draft = await draftMessage(editing!, publicUrl);
        if (fromPanel(interaction)) await interaction.update(draft);
        else await interaction.reply({ ...draft, flags: MessageFlags.Ephemeral });
      },
    },
    {
      action: "discard",
      async execute(interaction, [id = ""], { database: { db }, log }) {
        if (!interaction.isMessageComponent()) return;
        const row = await ownedInstance(db, id, interaction.user.id);
        await db
          .update(table)
          .set({
            status: "posted",
            assignments: row.postedAssignments ?? row.assignments,
            answerOptions: postedOptions(row),
            ...postedDisplay(row),
            previewToken: null,
            previewTokenAt: null,
            expiresAt: new Date(Date.now() + POSTED_TTL_MS),
            // The board went back to the posted version, which pages must load again.
            revision: sql`${table.revision} + 1`,
          })
          .where(eq(table.id, id));
        forgetPreview(id);
        await notifyWeb(db, id, log);
        await finish(interaction, "Changes discarded. The posted roster is unchanged.");
      },
    },
    {
      action: "answer",
      async execute(interaction, [id = "", choice = ""], { client, database: { db }, log }) {
        if (!interaction.isMessageComponent()) return;
        const [row] = await db.select().from(table).where(eq(table.id, id));
        if (!row || row.status === "draft" || row.postedMessageId !== interaction.message.id) {
          throw new UserFacingError("This roster is no longer active.");
        }

        const roster = buildRoster(
          storedEventSchema.parse(row.snapshot),
          assignmentsSchema.parse(row.postedAssignments ?? row.assignments),
        );
        if (!listedPlayers(roster).some((p) => p.discordUserId === interaction.user.id)) {
          throw new UserFacingError(
            "You are not listed on this roster, so you have nothing to answer.",
          );
        }

        // Buttons posted before answers were customised used "yes" and "no".
        const answer =
          ({ yes: CONFIRM_KEY, no: "denied" } as Record<string, string>)[choice] ?? choice;
        if (!postedOptions(row).some((o) => o.key === answer)) {
          throw new UserFacingError("That answer is no longer available.");
        }

        // One row per player. Pressing another answer switches to it. Pressing the same one again
        // doesn't remove it, because that is easy to do by accident. Withdrawing asks first.
        const key = { instanceId: id, userId: interaction.user.id };
        const [current] = await db
          .select()
          .from(responses)
          .where(and(eq(responses.instanceId, id), eq(responses.userId, key.userId)));
        if (current?.answer === answer) {
          const label = postedOptions(row).find((o) => o.key === answer)?.label ?? answer;
          await interaction.reply({
            content: `Your current answer is **${label}**. Do you want to withdraw it?`,
            components: [
              buttons(
                button("Withdraw answer", ButtonStyle.Danger, "withdraw", id),
                button("Keep answer", ButtonStyle.Secondary, "keep"),
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await db
          .insert(responses)
          .values({ ...key, answer })
          .onConflictDoUpdate({
            target: [responses.instanceId, responses.userId],
            set: { answer, updatedAt: new Date() },
          });

        await interaction.deferUpdate();
        counterThrottle.schedule(
          row.postedMessageId,
          () => redrawCounterById(client, db, id),
          (error) => log.warn({ err: error, roster: id }, "Could not update the roster message"),
        );
      },
    },
    {
      action: "withdraw",
      async execute(interaction, [id = ""], { client, database: { db }, log }) {
        if (!interaction.isMessageComponent()) return;
        const [row] = await db.select().from(table).where(eq(table.id, id));
        if (!row || row.status === "draft" || !row.postedMessageId) {
          throw new UserFacingError("This roster is no longer active.");
        }

        const removed = await db
          .delete(responses)
          .where(and(eq(responses.instanceId, id), eq(responses.userId, interaction.user.id)))
          .returning({ userId: responses.userId });
        await finish(
          interaction,
          removed.length > 0
            ? "Your answer has been withdrawn."
            : "You have no answer to withdraw.",
        );
        if (removed.length > 0) {
          counterThrottle.schedule(
            row.postedMessageId,
            () => redrawCounterById(client, db, id),
            (error) => log.warn({ err: error, roster: id }, "Could not update the roster message"),
          );
        }
      },
    },
    {
      action: "cancel",
      // Before anything is posted. Nothing public exists yet, so one click is enough.
      async execute(interaction, [id], { database: { db }, log }) {
        if (!interaction.isMessageComponent()) return;
        if (id) {
          await ownedInstance(db, id, interaction.user.id);
          await db.delete(table).where(eq(table.id, id));
          forgetPreview(id);
          await notifyWeb(db, id, log);
        }
        await finish(interaction, "Roster cancelled.", { immediately: true });
      },
    },
    {
      action: "delete",
      // Only asks. Nothing is removed until the person confirms.
      async execute(interaction, [id = ""], { database: { db } }) {
        if (!interaction.isMessageComponent()) return;
        await ownedInstance(db, id, interaction.user.id);
        const ask = {
          content: "Delete this roster? The posted message and its link will be removed.",
          components: [
            buttons(
              button("Delete roster", ButtonStyle.Danger, "confirm-delete", id),
              button("Keep roster", ButtonStyle.Secondary, "keep"),
            ),
          ],
        };
        if (fromPanel(interaction)) await interaction.update(ask);
        else await interaction.reply({ ...ask, flags: MessageFlags.Ephemeral });
      },
    },
    {
      action: "confirm-delete",
      async execute(interaction, [id = ""], { database: { db }, client, log }) {
        if (!interaction.isMessageComponent()) return;
        const row = await ownedInstance(db, id, interaction.user.id);
        if (row.postedMessageId) {
          const posted = await fetchMessage(client, row.channelId, row.postedMessageId);
          await posted?.delete().catch(() => undefined);
          counterThrottle.forget(row.postedMessageId);
        }
        await db.delete(table).where(eq(table.id, id));
        forgetPreview(id);
        await notifyWeb(db, id, log);
        forgetPingCooldown(id);
        await finish(interaction, "Roster deleted.");
      },
    },
    {
      action: "keep",
      async execute(interaction) {
        if (!interaction.isMessageComponent()) return;
        await finish(interaction, "No changes were made.", { immediately: true });
      },
    },
  ],
  jobs: [
    defineJob({
      type: "roster.preview",
      execute: ({ id }, context) => refreshPreview(context, id),
    }),
    defineJob({
      type: "roster.emojis",
      execute: ({ id }, context) => refreshEmojis(context, id),
    }),
  ],
};
