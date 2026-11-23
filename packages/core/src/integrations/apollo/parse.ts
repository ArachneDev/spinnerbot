import type { EventSnapshot, ResponseStatus } from "../../events.js";

/** The parts of a Discord embed the parser reads. Matches the REST payload of Apollo's message. */
export interface RawEmbed {
  title?: string | null;
  description?: string | null;
  fields?: { name: string; value: string }[] | null;
}

export interface RawApolloMessage {
  embeds: RawEmbed[];
}

const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const HEADER = /^(Accepted|Declined|Tentative)(?: \((\d+)\))?$/;
const QUOTE_PREFIX = ">>> ";

/**
 * Reads an Apollo event message. Layout learned from captured messages in
 * test/fixtures/apollo: sign-ups are embed fields named "<emoji> Accepted (N)", with one display
 * name per line after a ">>> " prefix. An empty list is "-" and drops the count from the header.
 * Apollo gives names only, never Discord IDs.
 */
export function parseApolloMessage(message: RawApolloMessage): EventSnapshot {
  const embed = message.embeds[0];
  if (!embed?.title) throw new Error("Not an Apollo event message: no embed title");

  const responses: EventSnapshot["responses"] = { accepted: [], declined: [], tentative: [] };
  let complete = true;
  let startsAt: Date | undefined;

  for (const field of embed.fields ?? []) {
    if (field.name === "Time") {
      const stamp = /<t:(\d+):F>/.exec(field.value);
      if (stamp) startsAt = new Date(Number(stamp[1]) * 1000);
      continue;
    }
    const header = HEADER.exec(field.name.replace(CUSTOM_EMOJI, "").trim());
    if (!header) continue;

    const status = header[1]!.toLowerCase() as ResponseStatus;
    const names = parseNames(field.value);
    responses[status] = names.map((displayName) => ({ displayName }));
    // The header count lets us notice truncated lists.
    if (header[2] !== undefined && Number(header[2]) !== names.length) complete = false;
  }

  return {
    title: embed.title,
    ...(embed.description ? { description: embed.description } : {}),
    ...(startsAt ? { startsAt } : {}),
    responses,
    complete,
  };
}

function parseNames(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === "-") return [];
  const body = trimmed.startsWith(QUOTE_PREFIX) ? trimmed.slice(QUOTE_PREFIX.length) : trimmed;
  return body
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
}
