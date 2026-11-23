import { parseSteamRef, type SteamRef } from "./steam.js";

// Reads a Discord channel copied as text, the way the client puts it on the clipboard. It holds
// display names and no user IDs, so whoever uses this still has to match names to members.
//
//   [TAG] Player [TAG], Role icon, OFFICER — 01/09/2026 20:17     an author line
//   https://steamcommunity.com/profiles/76561198000000001/ (Friend code: 39734273)
//   [TAG] Leader [TAG], Role icon, OFFICER                          a channel owner's author line
//   OP
//    — 01/09/2026 20:14
//   Steam Community :: Player                                        a link preview, up to "Image"

const TIMESTAMP = /(?:^|\s)— (?:\d{2}\/\d{2}\/\d{4}|Today at|Yesterday at)[ \d:]*$/;
const SYSTEM_LINE = /pinned a message to this channel/;
const ROLE_ICON = /Role icon,.*$/;
/** The tag a member shows from their primary server, as opposed to one typed in their nickname. */
const SERVER_TAG = /\s*\[[^\]]*\],\s*$/;
const PREVIEW_START = /^Steam Community ::/;
const PREVIEW_END = /^Image$/;

const URL_TEXT = /\S*:\/\/\S+/g;
const PROFILE_LINK = /(?:https?:\/\/)?steamcommunity\.com\/(?:profiles|id)\/[\w-]+\/?/gi;
const NUMBER = /(?<![\w/])\d{5,17}(?![\w/])/g;

export interface ImportedSteamProfile {
  /** The display name, without role and server-tag decoration. */
  name: string;
  /** Everything this person posted about their account, the most dependable first. */
  refs: SteamRef[];
}

function cleanName(line: string): string {
  return line.replace(ROLE_ICON, "").replace(SERVER_TAG, "").trim();
}

function refsIn(line: string): SteamRef[] {
  const links = line.match(PROFILE_LINK) ?? [];
  const numbers = line.replace(URL_TEXT, " ").match(NUMBER) ?? [];
  return [...links, ...numbers].flatMap((text) => parseSteamRef(text) ?? []);
}

const sameRef = (a: SteamRef, b: SteamRef) => JSON.stringify(a) === JSON.stringify(b);

/** IDs are permanent, and a vanity name can be given up and taken by someone else. */
function byDependability(a: SteamRef, b: SteamRef): number {
  return Number(a.kind === "vanity") - Number(b.kind === "vanity");
}

/** Whoever posted a Steam account in the copied channel, in the order they first did. */
export function parseSteamChat(text: string): ImportedSteamProfile[] {
  const lines = text.split(/\r?\n/);
  const found = new Map<string, SteamRef[]>();
  let author: string | undefined;
  let inPreview = false;

  lines.forEach((line, index) => {
    if (TIMESTAMP.test(line)) {
      inPreview = false;
      if (SYSTEM_LINE.test(line)) {
        author = undefined;
        return;
      }
      const inline = line.slice(0, line.lastIndexOf("—")).trim();
      const previous = lines[index - 1]?.trim() === "OP" ? lines[index - 2] : lines[index - 1];
      author = cleanName(inline || (previous ?? ""));
      return;
    }
    if (PREVIEW_START.test(line)) inPreview = true;
    else if (PREVIEW_END.test(line)) inPreview = false;
    else if (!inPreview && author && author !== "Deleted User") {
      const refs = refsIn(line);
      if (refs.length > 0) found.set(author, [...(found.get(author) ?? []), ...refs]);
    }
  });

  return [...found].map(([name, refs]) => ({
    name,
    refs: refs
      .filter((ref, i) => refs.findIndex((other) => sameRef(ref, other)) === i)
      .sort(byDependability),
  }));
}
