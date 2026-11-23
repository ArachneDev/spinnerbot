import { type Interaction, MessageFlags, type RepliableInteraction } from "discord.js";
import { mayUseCommand } from "./access.js";
import { deleteReplyAfter, NOTICE_SHOWN_MS } from "./dismiss.js";
import { UserFacingError } from "./errors.js";
import type { Registry } from "./registry.js";
import type { FeatureContext } from "./types.js";

const FAILURE_MESSAGE = "Something went wrong. Please try again.";
const MESSAGE_LIMIT = 2000;
/** The first line of a private message that failed. A later failure replaces it. */
const ERROR_LINE = /^> ⚠️ [^\n]*\n?/;

/** A private message's text with the error on top, keeping the rest, such as a builder link. */
export function withError(content: string, error: string): string {
  const rest = content.replace(ERROR_LINE, "");
  return `> ⚠️ ${error}${rest ? `\n${rest}` : ""}`.slice(0, MESSAGE_LIMIT);
}

/** Sends a private failure notice, whatever state the interaction has reached. */
async function reportFailure(
  interaction: RepliableInteraction,
  content: string,
  context: FeatureContext,
): Promise<void> {
  try {
    const done = interaction.deferred || interaction.replied;
    if (interaction.isMessageComponent() && interaction.message.flags.has(MessageFlags.Ephemeral)) {
      // A private message says what went wrong itself, and keeps its buttons and link.
      const update = { content: withError(interaction.message.content, content) };
      if (done) await interaction.editReply(update);
      else await interaction.update(update);
    } else if (interaction.isMessageComponent()) {
      // The button is on a public message, which must stay as it is. The notice removes itself.
      if (done) {
        const notice = await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        deleteReplyAfter(interaction, NOTICE_SHOWN_MS, notice);
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        deleteReplyAfter(interaction, NOTICE_SHOWN_MS);
      }
    } else if (done) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    // The interaction may have expired. Nothing more can be said to the user.
    context.log.warn({ err: error }, "Could not report a failure to the user");
  }
}

/** Runs one handler. A failure is logged and reported, and stops here. */
async function guarded(
  interaction: RepliableInteraction,
  feature: string,
  label: string,
  context: FeatureContext,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof UserFacingError) {
      await reportFailure(interaction, error.message, context);
      return;
    }
    context.log.error({ err: error, feature, label, user: interaction.user.id }, "Handler failed");
    await reportFailure(interaction, FAILURE_MESSAGE, context);
  }
}

export async function routeInteraction(
  interaction: Interaction,
  registry: Registry,
  context: FeatureContext,
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const registered = registry.commands.get(interaction.commandName);
    if (!registered) {
      context.log.warn({ command: interaction.commandName }, "Unknown command");
      await reportFailure(interaction, "This command is no longer available.", context);
      return;
    }
    const { feature, handler } = registered;
    const log = context.log.child({ feature, command: interaction.commandName });
    await guarded(
      interaction,
      feature,
      `/${interaction.commandName}`,
      { ...context, log },
      async () => {
        if (
          !(await mayUseCommand(interaction, context.database.db)) ||
          (handler.requiredPermissions &&
            !interaction.memberPermissions?.has(handler.requiredPermissions))
        ) {
          await interaction.reply({
            content: "You do not have permission to use this command.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (handler.defer !== "none") {
          await interaction.deferReply(
            handler.defer === "ephemeral" ? { flags: MessageFlags.Ephemeral } : {},
          );
        }
        await handler.execute(interaction, { ...context, log });
      },
    );
    return;
  }

  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    const [feature = "", action = "", ...args] = interaction.customId.split(":");
    const registered = registry.components.get(`${feature}:${action}`);
    if (!registered) {
      // Buttons outlive deployments, so an old one can point at something since removed.
      context.log.warn({ customId: interaction.customId }, "Unknown component");
      await reportFailure(interaction, "This control is no longer active.", context);
      return;
    }
    const log = context.log.child({ feature, action });
    await guarded(interaction, feature, `${feature}:${action}`, { ...context, log }, () =>
      registered.handler.execute(interaction, args, { ...context, log }),
    );
  }
}
