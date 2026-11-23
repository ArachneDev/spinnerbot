import { type BaseInteraction, DiscordAPIError, PermissionFlagsBits } from "discord.js";
import { UserFacingError } from "../../framework/errors.js";

/** What the roster message needs. Read Message History is for redrawing the answer counter. */
const NEEDED: [bigint, string][] = [
  [PermissionFlagsBits.ViewChannel, "View Channel"],
  [PermissionFlagsBits.SendMessages, "Send Messages"],
  [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  [PermissionFlagsBits.AttachFiles, "Attach Files"],
  [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
];
const NEEDED_IN_THREAD: [bigint, string] = [
  PermissionFlagsBits.SendMessagesInThreads,
  "Send Messages in Threads",
];

export const CANT_POST_HERE =
  "Spinner Bot can't post in this channel. Run /build-roster in another channel, or check the bot's permissions here.";

const channelFix = (missing: string) =>
  `Spinner Bot can't post in this channel. It needs: ${missing}. Grant this here, or run /build-roster in another channel.`;

/** Discord tells every interaction what the bot may do in that channel, so nothing is fetched. */
export function assertCanPost(
  interaction: Pick<BaseInteraction, "appPermissions" | "channel">,
): void {
  const needed = interaction.channel?.isThread()
    ? NEEDED.map((entry) => (entry[1] === "Send Messages" ? NEEDED_IN_THREAD : entry))
    : NEEDED;
  const missing = needed
    .filter(([flag]) => !interaction.appPermissions.has(flag))
    .map(([, name]) => name);
  if (missing.length > 0) {
    throw new UserFacingError(channelFix(missing.join(", ")));
  }
}

const REFUSALS: Record<number, string> = {
  // Permissions can differ from what the interaction reported if they changed in the meantime.
  50001: channelFix("View Channel"),
  50013: channelFix("Send Messages, Embed Links, Attach Files"),
  10003: "This channel no longer exists. Run /build-roster in another channel.",
  10008: "The posted roster no longer exists. Press **Update roster** again to post a new one.",
  40005: "The roster's images are too large for Discord. Turn off the banner and try again.",
  50035:
    "Discord rejected the roster's content. Check the custom images, emoji and long text on the roster builder, then try again.",
};

/** A refused post, in words the leader can act on. Anything unexpected is passed on and logged. */
export function postFailure(error: unknown): unknown {
  if (!(error instanceof DiscordAPIError)) return error;
  if (error.status >= 500) {
    return new UserFacingError("Discord is not responding. Nothing was posted. Please try again.");
  }
  const refusal = REFUSALS[Number(error.code)];
  return refusal
    ? new UserFacingError(refusal)
    : new UserFacingError(`Discord refused the roster (error ${error.code}). Nothing was posted.`);
}
