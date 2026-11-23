import {
  type BaseInteraction,
  type Message,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
} from "discord.js";
import {
  buildRoster,
  listedPlayers,
  type AnswerOption,
  type Assignments,
  type StoredEvent,
} from "@scrimbot/core";

type Person = StoredEvent["responses"]["accepted"][number];

export const PING_COOLDOWN_MS = 10 * 60 * 1000;
export const PING_TEXT = "Roster check: please answer on the roster above.";
export const PING_THREAD_NAME = "Roster pings";
const MESSAGE_LIMIT = 2000;
/** Discord honours at most 100 users in one message's allowed mentions. */
const MENTIONS_PER_MESSAGE = 100;

/** Listed players with no answer yet, split by whether they can be mentioned. */
export function pendingPlayers(
  event: StoredEvent,
  assignments: Assignments,
  answers: ReadonlyMap<string, string>,
  options: AnswerOption[],
): { pingable: (Person & { discordUserId: string })[]; unmatched: Person[] } {
  const keys = new Set(options.map((o) => o.key));
  // An answer whose button was since removed counts as none, as it does on the roster.
  const pending = listedPlayers(buildRoster(event, assignments)).filter(
    (p) => !keys.has(answers.get(p.discordUserId ?? "") ?? ""),
  );
  return {
    pingable: pending.filter((p): p is Person & { discordUserId: string } =>
      Boolean(p.discordUserId),
    ),
    unmatched: pending.filter((p) => !p.discordUserId),
  };
}

/** The ping as messages, each under Discord's length and mention limits, with its own users. */
export function pingMessages(userIds: string[]): { content: string; users: string[] }[] {
  const messages: { content: string; users: string[] }[] = [];
  let current = { content: PING_TEXT, users: [] as string[] };
  for (const id of new Set(userIds)) {
    const mention = `<@${id}>`;
    const separator = current.users.length === 0 ? "\n" : " ";
    if (
      current.content.length + separator.length + mention.length > MESSAGE_LIMIT ||
      current.users.length === MENTIONS_PER_MESSAGE
    ) {
      messages.push(current);
      current = { content: mention, users: [id] };
      continue;
    }
    current.content += separator + mention;
    current.users.push(id);
  }
  if (current.users.length > 0) messages.push(current);
  return messages;
}

/** Why a ping can't go in a thread, or nothing when it can. */
export function threadProblem(
  interaction: Pick<BaseInteraction, "appPermissions" | "channel">,
): string | undefined {
  if (interaction.channel?.isThread()) {
    return "The roster is inside a thread, so the ping will be a reply to it.";
  }
  const missing = (
    [
      [PermissionFlagsBits.CreatePublicThreads, "Create Public Threads"],
      [PermissionFlagsBits.SendMessagesInThreads, "Send Messages in Threads"],
    ] as const
  )
    .filter(([flag]) => !interaction.appPermissions.has(flag))
    .map(([, name]) => name);
  return missing.length > 0
    ? `Spinner Bot can't use a thread here. It needs: ${missing.join(", ")}. The ping will be a reply to the roster in this channel instead.`
    : undefined;
}

/** A thread started from a message shares its ID, so the roster's thread is found without storing it. */
async function rosterThread(roster: Message) {
  const found = await roster.client.channels.fetch(roster.id).catch(() => null);
  if (found?.isThread()) {
    if (found.archived) await found.setArchived(false);
    return found;
  }
  return roster.startThread({
    name: PING_THREAD_NAME,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
  });
}

/** Sends the ping in the roster's thread, or as replies to the roster. Returns a link to it. */
export async function sendPing(
  roster: Message,
  userIds: string[],
  inThread: boolean,
): Promise<{ inThread: boolean; url: string }> {
  const messages = pingMessages(userIds);
  if (inThread) {
    const thread = await rosterThread(roster);
    for (const { content, users } of messages) {
      await thread.send({ content, allowedMentions: { parse: [], users } });
    }
    return { inThread, url: thread.url };
  }
  let first: Message | undefined;
  for (const { content, users } of messages) {
    const sent = await roster.reply({
      content,
      allowedMentions: { parse: [], users, repliedUser: false },
    });
    first ??= sent;
  }
  return { inThread, url: first!.url };
}

// Kept in memory: a restart only lets the leader ping once more.
const lastPing = new Map<string, number>();

/** When the roster may be pinged again, or undefined if it may be now. */
export function pingAllowedAt(id: string, now = Date.now()): Date | undefined {
  const at = lastPing.get(id);
  return at !== undefined && now - at < PING_COOLDOWN_MS
    ? new Date(at + PING_COOLDOWN_MS)
    : undefined;
}
export const startPingCooldown = (id: string, now = Date.now()) => void lastPing.set(id, now);
export const forgetPingCooldown = (id: string) => void lastPing.delete(id);
