import { describe, expect, it } from "vitest";
import {
  isSteamLobby,
  parseSteamChat,
  parseSteamProfilePage,
  parseSteamRef,
  steamJoinUrl,
} from "../src/index.js";

const id = (steamId: string) => ({ kind: "id", steamId });
const vanity = (name: string) => ({ kind: "vanity", vanity: name });

describe("parseSteamRef", () => {
  it.each([
    ["https://steamcommunity.com/profiles/76561198000000010/", id("76561198000000010")],
    ["steamcommunity.com/profiles/76561198000000010", id("76561198000000010")],
    ["https://steamcommunity.com/id/Some_Name-1/?l=english", vanity("Some_Name-1")],
    ["76561198000000010", id("76561198000000010")],
    // The friend code of the profile above.
    [" 39734282 ", id("76561198000000010")],
  ])("reads %s", (text, wanted) => {
    expect(parseSteamRef(text)).toEqual(wanted);
  });

  it.each([
    "hello",
    "1234",
    "https://example.com/id/someone/",
    "https://steamcommunity.com/chat/invite/Mg8BDY6M",
    "https://steamcommunity.com/profiles/123/",
    "https://steamcommunity.com.evil.example/id/someone/",
    "99999999999",
  ])("refuses %s", (text) => {
    expect(parseSteamRef(text)).toBeUndefined();
  });
});

// The layouts are those of a real copied channel, with the names and accounts replaced.
const CHAT = `[AAAA] Plain NoTagRole icon, HELLHOUND — 01/09/2026 20:11
https://steamcommunity.com/profiles/76561198000000001/
[AAAA] Vanity [AAAA], Role icon, WEB WEAVER — 01/09/2026 20:11
https://steamcommunity.com/id/SomeVanity/
[AAAA] Owner [AAAA], Role icon, TRIARCH
OP
 — 01/09/2026 20:14
https://steamcommunity.com/profiles/76561198000000002/ - 39734274
Steam Community :: Owner
Image
[AAAA] Both [BBBB], Role icon, WARHOUND — 02/09/2026 19:11
https://steamcommunity.com/id/bothvanity/

Steam ID: 76561198000000003
Steam Community :: Both
All you need to know is 4200000, a number in a bio
Image
Friendly — 03/09/2026 18:40
Actually just use this friend code XD
39734277
Tagged [CCCC],  — 03/09/2026 18:40
39734278 my friend code
Late [AAAA], Role icon, WARHOUND — Yesterday at 00:44
76561198000000006
Deleted User — 01/09/2026 22:19
167885400
[AAAA] Owner [AAAA], Role icon, TRIARCH
OP
 — 11/10/2026 13:26
Made a steam group so you can find people online in here too
https://steamcommunity.com/chat/invite/AbCdEfGh
Steam Community :: Chat Invitation
Steam Community :: Chat Invitation
[AAAA] Owner
[AAAA] Owner
 pinned a message to this channel. See all pinned messages. — 11/10/2026 13:27
 [AAAA],
Chatty [AAAA], Role icon, WARHOUND — 11/10/2026 13:36
Great idea, see you at 20:00 on 11/10/2026
`;

describe("parseSteamChat", () => {
  const people = parseSteamChat(CHAT);
  const refsOf = (name: string) => people.find((person) => person.name === name)?.refs;

  it("cleans names and finds only the people who posted an account", () => {
    expect(people.map((person) => person.name)).toEqual([
      "[AAAA] Plain NoTag",
      "[AAAA] Vanity",
      "[AAAA] Owner",
      "[AAAA] Both",
      "Friendly",
      "Tagged",
      "Late",
    ]);
  });

  it("reads links, friend codes and bare IDs", () => {
    expect(refsOf("[AAAA] Plain NoTag")).toEqual([id("76561198000000001")]);
    expect(refsOf("[AAAA] Vanity")).toEqual([vanity("SomeVanity")]);
    expect(refsOf("Friendly")).toEqual([id((76561197960265728n + 39734277n).toString())]);
    expect(refsOf("Tagged")).toEqual([id((76561197960265728n + 39734278n).toString())]);
    expect(refsOf("Late")).toEqual([id("76561198000000006")]);
  });

  it("merges a link and friend code for the same account, under the channel-owner layout", () => {
    expect(refsOf("[AAAA] Owner")).toEqual([id("76561198000000002")]);
  });

  it("prefers an ID to a vanity name, and ignores text inside link previews", () => {
    expect(refsOf("[AAAA] Both")).toEqual([id("76561198000000003"), vanity("bothvanity")]);
  });

  it("skips deleted users, who can't be matched to anyone", () => {
    expect(refsOf("Deleted User")).toBeUndefined();
  });
});

describe("parseSteamProfilePage", () => {
  const STEAM_ID = "76561198000000010";
  const profile = (body: string) =>
    `<script>g_rgProfileData = {"steamid":"${STEAM_ID}"};</script>${body}`;
  const joinButton = `<div class="profile_in_game_name">Tom &amp; Jerry&#39;s Game</div>
    <a href="steam://joinlobby/686810/109775241000000000/${STEAM_ID}" class="btn"><span>Join Game</span></a>`;

  it("reads the lobby and game of someone in a joinable game", () => {
    expect(parseSteamProfilePage(profile(joinButton))).toEqual({
      steamId: STEAM_ID,
      isPrivate: false,
      gameName: "Tom & Jerry's Game",
      lobby: { appId: "686810", lobbyId: "109775241000000000", steamId: STEAM_ID },
    });
  });

  it("finds nothing to join when they are offline", () => {
    const page = parseSteamProfilePage(
      profile(`<div class="profile_in_game_header">Currently Offline</div>`),
    );
    expect(page).toEqual({ steamId: STEAM_ID, isPrivate: false });
  });

  it("isn't fooled by a link typed in a comment", () => {
    const comment = `<div class="commentthread_comment_text">steam://joinlobby/1/2/${STEAM_ID}</div>`;
    expect(parseSteamProfilePage(profile(comment))?.lobby).toBeUndefined();
  });

  it("prefers the owner's lobby to any other link", () => {
    const other = `<a href="steam://joinlobby/1/2/76561198000000001">x</a>`;
    expect(parseSteamProfilePage(profile(other + joinButton))?.lobby?.appId).toBe("686810");
  });

  it("notices a private profile", () => {
    const page = parseSteamProfilePage(profile(`<div class="profile_private_info">private</div>`));
    expect(page?.isPrivate).toBe(true);
  });

  it("returns nothing for a page that isn't a profile", () => {
    expect(
      parseSteamProfilePage("<html>The specified profile could not be found.</html>"),
    ).toBeUndefined();
  });
});

describe("steam lobby links", () => {
  it("builds the link Steam expects", () => {
    expect(steamJoinUrl({ appId: "1", lobbyId: "2", steamId: "3" })).toBe(
      "steam://joinlobby/1/2/3",
    );
  });

  it("accepts only digits", () => {
    expect(isSteamLobby({ appId: "1", lobbyId: "2", steamId: "3" })).toBe(true);
    expect(isSteamLobby({ appId: "1", lobbyId: "2", steamId: '3"><script>' })).toBe(false);
    expect(isSteamLobby({ appId: "", lobbyId: "2", steamId: "3" })).toBe(false);
  });
});
