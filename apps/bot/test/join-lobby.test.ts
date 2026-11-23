import { describe, expect, it, vi } from "vitest";
import { ButtonStyle, type APIButtonComponentWithCustomId, type APIGuildMember } from "discord.js";
import { matchMember, searchNames } from "../src/features/join-lobby/import-match.js";
import { createSteamClient } from "../src/features/join-lobby/steam.js";
import {
  joinMessage,
  lobbyMessages,
  steamLinkMessages,
  type VoicePlayer,
} from "../src/features/join-lobby/view.js";

const STEAM_ID = "76561198000000010";
const ref = { kind: "id", steamId: STEAM_ID } as const;
const PROFILE = `<script>{"steamid":"${STEAM_ID}"}</script>`;

function fakeSteam(responses: (string | number)[]) {
  let clock = 1_000_000;
  const slept: number[] = [];
  const request = vi.fn(async () => {
    const next = responses.shift() ?? PROFILE;
    return typeof next === "number"
      ? new Response("", { status: next })
      : new Response(next, { status: 200 });
  });
  const client = createSteamClient({
    fetch: request as unknown as typeof fetch,
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  });
  return { client, request, slept, advance: (ms: number) => (clock += ms) };
}

describe("Steam client", () => {
  it("keeps a gap between requests", async () => {
    const { client, slept } = fakeSteam([]);
    await Promise.all([
      client.check(ref),
      client.check({ kind: "id", steamId: "76561198000000011" }),
    ]);
    expect(slept).toEqual([1000]);
  });

  it("asks Steam once for the same profile in a short time, and again after", async () => {
    const { client, request, advance } = fakeSteam([]);
    await Promise.all([client.check(ref), client.check(ref)]);
    await client.check(ref);
    expect(request).toHaveBeenCalledOnce();
    advance(31_000);
    await client.check(ref);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("waits out a 429 and tries once more", async () => {
    const { client, request, slept } = fakeSteam([429, PROFILE]);
    expect((await client.check(ref)).status).toBe("found");
    expect(request).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([20_000]);
  });

  it("stops asking while Steam keeps refusing, rather than making everyone wait", async () => {
    const { client, request } = fakeSteam([429, 429]);
    const others = ["1", "2", "3"].map(
      (n) => ({ kind: "id", steamId: `7656119800000002${n}` }) as const,
    );
    const checks = await Promise.all([client.check(ref), ...others.map((o) => client.check(o))]);
    expect(checks.map((check) => check.status)).toEqual(Array(4).fill("unavailable"));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("doesn't remember a failure", async () => {
    const { client, request } = fakeSteam([500, PROFILE]);
    expect((await client.check(ref)).status).toBe("unavailable");
    expect((await client.check(ref)).status).toBe("found");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("tells a missing profile from a failure", async () => {
    const { client } = fakeSteam(["<html>not a profile</html>"]);
    expect((await client.check(ref)).status).toBe("missing");
  });

  it("reports a network failure as unavailable", async () => {
    const client = createSteamClient({
      fetch: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    expect((await client.check(ref)).status).toBe("unavailable");
  });
});

const OWNER = "42";

function player(n: number, kind: VoicePlayer["status"]["kind"] = "joinable"): VoicePlayer {
  return { userId: String(1000 + n), name: `Player ${n}`, status: { kind } };
}

const json = (message: ReturnType<typeof lobbyMessages>[number]) => ({
  embed: (
    message.embeds![0] as {
      toJSON(): {
        fields?: { name: string; value: string }[];
        description?: string;
        title?: string;
      };
    }
  ).toJSON(),
  // The last row always holds Refresh and Delete.
  rows: (
    message.components as unknown as {
      toJSON(): { components: APIButtonComponentWithCustomId[] };
    }[]
  )
    .map((row) => row.toJSON().components)
    .slice(0, -1),
  controls: (
    message.components as unknown as {
      toJSON(): { components: APIButtonComponentWithCustomId[] };
    }[]
  )
    .at(-1)!
    .toJSON()
    .components.map((button) => button.custom_id),
});

describe("lobbyMessages", () => {
  it("lists each channel, those who can be joined first, with buttons only for them", () => {
    const [message, ...rest] = lobbyMessages(
      [
        {
          name: "Squad 1",
          players: [player(1, "unlinked"), player(2), player(3, "idle")],
        },
        { name: "Squad 2", players: [player(4, "private"), player(5, "unknown")] },
      ],
      OWNER,
    );
    expect(rest).toEqual([]);
    const { embed, rows } = json(message!);
    expect(embed.fields?.map((field) => field.name)).toEqual(["Squad 1", "Squad 2"]);
    expect(embed.fields?.[0]?.value.split("\n").map((line) => line.split(":")[0])).toEqual([
      "🟢 **Player 2**",
      "⚪ **Player 3**",
      "❔ **Player 1**",
    ]);
    // One row per channel, and a press checks with Steam again if it didn't answer.
    expect(rows.map((row) => row.map((button) => button.custom_id))).toEqual([
      ["join-lobby:join:1002"],
      ["join-lobby:join:1005"],
    ]);
    expect(rows[0]![0]!.style).toBe(ButtonStyle.Success);
    expect(rows[1]![0]!.style).toBe(ButtonStyle.Secondary);
  });

  it("says so when nobody is in voice, and can still be refreshed", () => {
    const [message] = lobbyMessages([{ name: "Empty", players: [] }], OWNER);
    const { embed, rows, controls } = json(message!);
    expect(embed.description).toContain("No one");
    expect(rows).toEqual([]);
    expect(controls).toEqual([`join-lobby:refresh:${OWNER}:0`, `join-lobby:delete:${OWNER}`]);
  });

  it("spreads over several messages within Discord's limits, losing nobody", () => {
    const players = Array.from({ length: 60 }, (_, n) => player(n));
    const messages = lobbyMessages([{ name: "Everyone", players }], OWNER).map(json);
    expect(messages).toHaveLength(3);
    expect(messages[1]!.embed.title).toBe("Join game (2/3)");
    expect(messages[1]!.embed.fields?.[0]?.name).toBe("Everyone (continued)");
    expect(messages[1]!.controls[0]).toBe(`join-lobby:refresh:${OWNER}:1`);
    for (const { rows, embed } of messages) {
      expect(rows.length).toBeLessThanOrEqual(4);
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(5);
      expect(JSON.stringify(embed).length).toBeLessThan(6000);
      for (const field of embed.fields ?? []) expect(field.value.length).toBeLessThanOrEqual(1024);
    }
    const pressed = messages.flatMap(({ rows }) => rows.flat().map((button) => button.custom_id));
    expect(new Set(pressed).size).toBe(60);
  });

  it("stays within the limits with many channels and long names", () => {
    const long = "x".repeat(90);
    const channels = Array.from({ length: 30 }, (_, c) => ({
      name: `${long}${c}`,
      players: Array.from({ length: 12 }, (_, n) => ({
        ...player(c * 100 + n, n % 2 ? "joinable" : "idle"),
        name: `${long}${n}`,
      })),
    }));
    const messages = lobbyMessages(channels, OWNER).map(json);
    for (const { rows, embed } of messages) {
      expect(rows.length).toBeLessThanOrEqual(4);
      expect((embed.fields ?? []).length).toBeLessThanOrEqual(25);
      expect(JSON.stringify(embed).length).toBeLessThan(6000);
      for (const row of rows) for (const b of row) expect(b.label!.length).toBeLessThanOrEqual(80);
    }
    const lines = messages.flatMap(({ embed }) =>
      (embed.fields ?? []).flatMap((field) => field.value.split("\n")),
    );
    expect(lines).toHaveLength(360);
  });
});

describe("steamLinkMessages", () => {
  const description = (message: ReturnType<typeof steamLinkMessages>[number]) =>
    (message.embeds![0] as { toJSON(): { description?: string } }).toJSON().description!;

  it("says so when there are none", () => {
    expect(steamLinkMessages([])).toEqual([{ content: "No Steam profiles are linked yet." }]);
  });

  it("spreads over several messages, losing nobody", () => {
    const links = Array.from({ length: 200 }, (_, n) => ({
      discordUserId: String(100000000000000000n + BigInt(n)),
      steamId: STEAM_ID,
    }));
    const messages = steamLinkMessages(links);
    expect(messages.length).toBeGreaterThan(1);
    const lines = messages.flatMap((message) => description(message).split("\n"));
    expect(lines).toHaveLength(200);
    expect(lines[0]).toBe(
      `<@100000000000000000> [${STEAM_ID}](https://steamcommunity.com/profiles/${STEAM_ID}/)`,
    );
    for (const message of messages) expect(description(message).length).toBeLessThanOrEqual(4096);
  });
});

describe("joinMessage", () => {
  it("links to the web page, since Discord refuses steam:// on buttons", () => {
    const message = joinMessage(
      "Some_One",
      "https://bot.example",
      { appId: "1", lobbyId: "2", steamId: "3" },
      "Game",
    );
    expect(message.content).toBe("**Some\\_One** has an open lobby in **Game**.");
    const [row] = message.components as unknown as {
      toJSON(): { components: { url: string; style: number }[] };
    }[];
    expect(row!.toJSON().components[0]).toMatchObject({
      url: "https://bot.example/api/join-lobby/1/2/3",
      style: ButtonStyle.Link,
    });
  });
});

const member = (id: string, names: { nick?: string; global?: string; username?: string }) =>
  ({
    nick: names.nick ?? null,
    user: { id, username: names.username ?? `user${id}`, global_name: names.global ?? null },
  }) as unknown as APIGuildMember;

describe("matching imported names to members", () => {
  it("also tries the name without its clan tag", () => {
    expect(searchNames("[TAG] Player")).toEqual(["[TAG] Player", "Player"]);
    expect(searchNames("Player")).toEqual(["Player"]);
  });

  it("takes the one exact match, ignoring case", () => {
    const found = [member("1", { nick: "Player Two" }), member("2", { nick: "PLAYER" })];
    expect(matchMember("player", found)).toBe(found[1]);
  });

  it("matches on global name and username", () => {
    expect(matchMember("glob", [member("1", { global: "Glob" })])).not.toBe("none");
    expect(matchMember("uname", [member("1", { username: "uname" })])).not.toBe("none");
  });

  it("refuses to guess", () => {
    const found = [member("1", { nick: "Same" }), member("2", { global: "same" })];
    expect(matchMember("Same", found)).toBe("ambiguous");
    expect(matchMember("Same Name", found)).toBe("none");
  });
});
