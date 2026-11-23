import type { APIGuildMember } from "discord.js";

const normalize = (text: string | null | undefined) => text?.trim().toLowerCase();
const LEADING_TAG = /^\[[^\]]*\]\s*/;

/** The names to look for: as written, then without a clan tag, since that often changes. */
export function searchNames(name: string): string[] {
  const untagged = name.replace(LEADING_TAG, "").trim();
  return untagged && untagged !== name ? [name, untagged] : [name];
}

/** The member with exactly this name. Guessing between several would link the wrong person. */
export function matchMember(
  name: string,
  members: APIGuildMember[],
): APIGuildMember | "none" | "ambiguous" {
  const key = normalize(name);
  const matches = members.filter((member) =>
    [member.nick, member.user.global_name, member.user.username].some(
      (candidate) => normalize(candidate) === key,
    ),
  );
  if (matches.length === 0) return "none";
  return matches.length === 1 ? matches[0]! : "ambiguous";
}
