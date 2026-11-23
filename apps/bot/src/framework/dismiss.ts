import type { Message, MessageComponentInteraction } from "discord.js";

/** Anything whose replies can be deleted: commands, buttons and modals. */
interface Replied {
  deleteReply(message?: Message): Promise<void>;
}

/** Long enough to read a one-line result. */
export const RESULT_SHOWN_MS = 5000;
/** A notice about a failure on a public message, which may need a moment's thought. */
export const NOTICE_SHOWN_MS = 15000;

/** Deletes a reply, ignoring failure: it may already be gone, or the interaction expired. */
function deleteQuietly(interaction: Replied, message?: Message): void {
  void Promise.resolve()
    .then(() => interaction.deleteReply(message))
    .catch(() => undefined);
}

/** Removes a private reply once it has been read. `message` picks a follow-up over the reply. */
export function deleteReplyAfter(interaction: Replied, ms: number, message?: Message): void {
  setTimeout(() => deleteQuietly(interaction, message), ms).unref?.();
}

/**
 * Shows a private message's last words briefly, then removes it, so a leader's steps don't leave
 * a trail of finished messages. The message is cleared first, in case the delete fails.
 */
export async function finish(
  interaction: MessageComponentInteraction,
  content: string,
  { immediately = false } = {},
): Promise<void> {
  const final = { content, embeds: [], components: [], attachments: [] };
  if (interaction.deferred || interaction.replied) await interaction.editReply(final);
  else await interaction.update(final);
  if (immediately) deleteQuietly(interaction);
  else deleteReplyAfter(interaction, RESULT_SHOWN_MS);
}
