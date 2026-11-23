/** Friend codes are the low 32 bits of a SteamID64, which adds this to them. */
const STEAM_ID_BASE = 76561197960265728n;
const MAX_FRIEND_CODE = 0xffffffffn;

const STEAM_ID = /^7656119\d{10}$/;
const FRIEND_CODE = /^\d{5,10}$/;
const PROFILE_URL =
  /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(?:profiles\/(7656119\d{10})|id\/([\w-]{2,64}))(?:[/?#].*)?$/i;

/** A Steam account as someone wrote it. A vanity name needs Steam to turn it into an ID. */
export type SteamRef = { kind: "id"; steamId: string } | { kind: "vanity"; vanity: string };

function fromFriendCode(code: string): SteamRef | undefined {
  const value = BigInt(code);
  if (value === 0n || value > MAX_FRIEND_CODE) return undefined;
  return { kind: "id", steamId: (STEAM_ID_BASE + value).toString() };
}

/** Accepts a profile link, a SteamID64 or a friend code. Undefined when the text is none of them. */
export function parseSteamRef(text: string): SteamRef | undefined {
  const value = text.trim();
  const link = PROFILE_URL.exec(value);
  if (link?.[1]) return { kind: "id", steamId: link[1] };
  if (link?.[2]) return { kind: "vanity", vanity: link[2] };
  if (STEAM_ID.test(value)) return { kind: "id", steamId: value };
  if (FRIEND_CODE.test(value)) return fromFriendCode(value);
  return undefined;
}

export function steamProfileUrl(ref: SteamRef): string {
  return ref.kind === "id"
    ? `https://steamcommunity.com/profiles/${ref.steamId}/`
    : `https://steamcommunity.com/id/${encodeURIComponent(ref.vanity)}/`;
}

/** The three numbers of a steam://joinlobby/ link. */
export interface SteamLobby {
  appId: string;
  lobbyId: string;
  steamId: string;
}

export interface SteamProfilePage {
  steamId: string;
  /** Steam hides game details on a private profile, so it never has a lobby to show. */
  isPrivate: boolean;
  gameName?: string;
  lobby?: SteamLobby;
}

const NUMERIC = /^\d{1,20}$/;
const PAGE_STEAM_ID = /"steamid":"(7656119\d{10})"/;
const PRIVATE_MARKER = /class="profile_private_info"/;
const GAME_NAME = /class="profile_in_game_name">([^<]*)</;
const LOBBY = /(href=")?steam:\/\/joinlobby\/(\d{1,20})\/(\d{1,20})\/(\d{1,20})/g;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * Finds the profile owner's lobby. Anyone can type a joinlobby link into a profile comment, and
 * Steam shows comments as text on the same page. The real button is a link, so plain text alone
 * never counts.
 */
function findLobby(html: string, steamId: string): SteamLobby | undefined {
  const links = [...html.matchAll(LOBBY)].filter((match) => match[1]);
  const link = links.find((match) => match[4] === steamId) ?? links[0];
  return link ? { appId: link[2]!, lobbyId: link[3]!, steamId: link[4]! } : undefined;
}

/** Reads a Steam profile page. Undefined when the page isn't a profile, as for an unknown one. */
export function parseSteamProfilePage(html: string): SteamProfilePage | undefined {
  const steamId = PAGE_STEAM_ID.exec(html)?.[1];
  if (!steamId) return undefined;
  const gameName = GAME_NAME.exec(html)?.[1]?.trim();
  const lobby = findLobby(html, steamId);
  return {
    steamId,
    isPrivate: PRIVATE_MARKER.test(html),
    ...(gameName && { gameName: decodeEntities(gameName) }),
    ...(lobby && { lobby }),
  };
}

export function isSteamLobby(lobby: SteamLobby): boolean {
  return [lobby.appId, lobby.lobbyId, lobby.steamId].every((part) => NUMERIC.test(part));
}

export function steamJoinUrl({ appId, lobbyId, steamId }: SteamLobby): string {
  return `steam://joinlobby/${appId}/${lobbyId}/${steamId}`;
}
