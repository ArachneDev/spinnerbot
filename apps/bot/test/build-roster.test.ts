import { describe, expect, it } from "vitest";
import {
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
  type Client,
  type BaseInteraction,
  type Guild,
} from "discord.js";
import { TINY_PNG, useAssets } from "./assets-fixture.js";
import { DEFAULT_ANSWER_OPTIONS, type StoredEvent } from "@scrimbot/core";
import { COLOURS } from "../src/framework/brand.js";
import type { RosterDisplay } from "../src/features/build-roster/display.js";
import { eventTimes } from "../src/features/build-roster/roster-image.js";
import { assertCanPost, postFailure } from "../src/features/build-roster/posting.js";
import { matchMembers, readEvent } from "../src/features/build-roster/source.js";
import {
  managePanel,
  postedComponents,
  rosterEmbed,
  rosterFiles,
  startingText,
} from "../src/features/build-roster/view.js";
import { UserFacingError } from "../src/framework/errors.js";

const event: StoredEvent = {
  title: "Scrim",
  complete: true,
  responses: {
    accepted: [
      { displayName: "Alice", discordUserId: "1" },
      { displayName: "Bob", discordUserId: "2" },
      { displayName: "Ghost" },
    ],
    declined: [],
    tentative: [],
  },
};

const assignments = { "0": 1, "1": 1, "2": 2 };
const options = DEFAULT_ANSWER_OPTIONS;
const answers = (entries: [string, string][]) => new Map(entries);

const names = (files: { name: string }[]) => files.map((file) => file.name);

describe("rosterEmbed", () => {
  useAssets({ "arachne-crest.png": TINY_PNG, "arachne-banner.webp": "banner" });
  const display: RosterDisplay = {
    squadNames: ["Alpha", "Bravo", "C", "D", "E", "F", "G"],
    squadLeaders: { "1": 1 },
    showBanner: false,
    showBench: true,
    embedStyle: {},
  };

  it("uses the squad names and lists the squad leader first, with the emblem", () => {
    const embed = rosterEmbed(event, assignments, new Map(), options, { display });
    expect(embed.data.fields?.[0]?.name).toBe("ALPHA · 2");
    expect(embed.data.fields?.[0]?.value).toBe("⏳ <@2> 👑\n⏳ <@1>");
    expect(embed.data.fields?.[1]?.name).toBe("BRAVO · 1");
  });

  it("is red while players are unplaced, and green once everyone is", () => {
    expect(rosterEmbed(event, { "0": 1 }, new Map(), options).data.color).toBe(COLOURS.primary);
    expect(rosterEmbed(event, assignments, new Map(), options).data.color).toBe(COLOURS.win);
  });

  it("attaches the Arachne banner when asked, and a custom one is just a link", async () => {
    const banner = { ...display, showBanner: true };
    const build = (d: RosterDisplay) =>
      rosterEmbed(event, assignments, new Map(), options, { display: d }).data.image?.url;
    expect(build(banner)).toBe("attachment://arachne-banner.webp");
    expect(names(await rosterFiles(event, assignments, banner))).toContain("arachne-banner.webp");
    expect(build(display)).toBeUndefined();
    expect(names(await rosterFiles(event, assignments, display))).not.toContain(
      "arachne-banner.webp",
    );

    const custom: RosterDisplay = {
      ...banner,
      embedStyle: { bannerUrl: "https://example.test/b.png" },
    };
    expect(build(custom)).toBe("https://example.test/b.png");
    expect(names(await rosterFiles(event, assignments, custom))).not.toContain(
      "arachne-banner.webp",
    );
  });

  it("draws the squads as a picture for the roster banner, once they have players", async () => {
    const banner: RosterDisplay = {
      ...display,
      showBanner: true,
      embedStyle: { bannerImage: "roster" },
    };
    const embed = rosterEmbed(event, assignments, new Map(), options, { display: banner });
    expect(embed.data.image?.url).toBe("attachment://roster.png");
    const image = (await rosterFiles(event, assignments, banner)).find(
      (file) => file.name === "roster.png",
    );
    expect(image?.attachment.subarray(1, 4).toString()).toBe("PNG");

    const empty = rosterEmbed(event, {}, new Map(), options, { display: banner });
    expect(empty.data.image).toBeUndefined();
    expect(names(await rosterFiles(event, {}, banner))).not.toContain("roster.png");
  }, 20_000);

  it("applies the leader's text, colour, icons and layout", () => {
    const clock = { name: "⏰" };
    const data = rosterEmbed(event, { "0": 1 }, new Map(), options, {
      display: {
        ...display,
        embedStyle: {
          heading: "WARDOGS // OP ORDER",
          title: "Night raid",
          description: "Bring armour.",
          footer: "Stay frosty",
          colour: "#00cdde",
          layout: "stacked",
          showTime: false,
          showProgress: false,
          benchName: "Reserves",
          pendingEmoji: clock,
          leaderEmoji: { id: "123456789012345678", name: "boss" },
          squadEmojis: [{ id: "223456789012345678", name: "wolf" }, null],
          thumbnail: "crest",
        },
        squadLeaders: { "1": 0 },
      },
    }).data;
    expect(data.author?.name).toBe("WARDOGS // OP ORDER");
    expect(data.title).toBe("Night raid");
    expect(data.description).toContain("Bring armour.");
    expect(data.description).not.toContain("▰");
    expect(data.footer?.text).toContain("Stay frosty");
    expect(data.color).toBe(0x00cdde);
    expect(data.thumbnail?.url).toBe("attachment://arachne-crest.png");
    expect(data.fields?.[0]?.name).toBe("<:wolf:223456789012345678> ALPHA · 1");
    expect(data.fields?.[0]?.inline).toBe(false);
    expect(data.fields?.[0]?.value).toBe("⏰ <@1> <:boss:123456789012345678>");
    expect(data.fields?.some((f) => f.name.startsWith("Reserves"))).toBe(true);
  });

  it("shows confirmations as a bar", () => {
    const embed = rosterEmbed(event, assignments, answers([["1", "confirmed"]]), options);
    expect(embed.data.description).toContain("▰▰▰▱▱▱▱▱▱▱");
  });

  it("hides the bench when the leader turned it off", () => {
    const partial = { "0": 1 };
    const shown = rosterEmbed(event, partial, new Map(), options, { display });
    const hidden = rosterEmbed(event, partial, new Map(), options, {
      display: { ...display, showBench: false },
    });
    expect(shown.data.fields?.some((f) => f.name.startsWith("Bench"))).toBe(true);
    expect(hidden.data.fields?.some((f) => f.name.startsWith("Bench"))).toBe(false);
  });

  it("counts only listed players who confirmed", () => {
    const embed = rosterEmbed(
      event,
      assignments,
      answers([
        ["1", "confirmed"],
        ["99", "confirmed"],
      ]),
      options,
    );
    expect(embed.data.description).toContain("Confirmed 1/3");
    expect(embed.data.fields?.[0]?.value).toBe("-# Assault\n✅ <@1>\n⏳ <@2>");
  });

  it("shows other answers and unmatched names, without counting them as confirmed", () => {
    const embed = rosterEmbed(event, assignments, answers([["2", "denied"]]), options);
    expect(embed.data.fields?.[0]?.value).toContain("❌ <@2>");
    expect(embed.data.fields?.[1]?.value).toBe("-# Assault\n⏳ Ghost");
    expect(embed.data.footer?.text).toContain("could not be matched");
    expect(embed.data.description).toContain("Confirmed 0/3");
    expect(embed.data.description).toContain("❌ Can’t make it: 1");
  });

  it("uses custom answers, and ignores answers whose button was removed", () => {
    const custom = [
      ...options.slice(0, 1),
      { key: "late", label: "Late", emoji: { id: "123456789012345678", name: "clock" } },
    ];
    const embed = rosterEmbed(
      event,
      assignments,
      answers([
        ["1", "late"],
        ["2", "denied"],
      ]),
      custom,
    );
    expect(embed.data.fields?.[0]?.value).toBe(
      "-# Assault\n<:clock:123456789012345678> <@1>\n⏳ <@2>",
    );
    expect(embed.data.description).toContain("<:clock:123456789012345678> Late: 1");
  });
});

describe("eventTimes", () => {
  it("gives London and central European time, with summer and winter names", () => {
    expect(eventTimes("2026-07-05T18:00:00Z")).toEqual({
      date: "Sunday 5 July",
      times: [
        ["7:00PM", "BST"],
        ["8:00PM", "CEST"],
      ],
    });
    expect(eventTimes("2026-11-01T18:00:00Z").times).toEqual([
      ["6:00PM", "GMT"],
      ["7:00PM", "CET"],
    ]);
  });
});

describe("managePanel", () => {
  it("holds Edit roster, Ping pending and Delete for that roster", () => {
    const ids = managePanel("roster-id").components[0]!.components.map(
      (c) => (c.data as { custom_id: string }).custom_id,
    );
    expect(ids).toEqual([
      "build-roster:edit:roster-id",
      "build-roster:ping-ask:roster-id",
      "build-roster:delete:roster-id",
    ]);
  });
});

describe("rosterEmbed preview", () => {
  it("is labelled a preview and looks like the real thing", () => {
    const embed = rosterEmbed(event, assignments, new Map(), options, { preview: true });
    expect(embed.data.author?.name).toBe("PREVIEW // ARACHNE // ROSTER");
    expect(embed.data.title).toBe("Scrim");
    expect(embed.data.fields?.[0]?.value).toBe("-# Assault\n⏳ <@1>\n⏳ <@2>");
    expect(embed.data.description).toContain("Placed 3 of 3");
    expect(embed.data.fields?.[0]?.name).toBe("CERBERUS · 2");
  });
});

describe("postedComponents", () => {
  it("makes one button per answer, then a single Manage button", () => {
    const [answerRow, manageRow] = postedComponents("roster-id", options);
    const ids = answerRow!.components.map((c) => (c.data as { custom_id: string }).custom_id);
    expect(ids).toEqual([
      "build-roster:answer:roster-id:confirmed",
      "build-roster:answer:roster-id:denied",
    ]);
    expect(manageRow!.components.map((c) => c.data)).toEqual([
      expect.objectContaining({ custom_id: "build-roster:manage:roster-id", label: "Manage" }),
    ]);
  });

  it("puts a server emoji on the button", () => {
    const [row] = postedComponents("id", [
      {
        key: "confirmed",
        label: "In",
        emoji: { id: "123456789012345678", name: "yes", animated: true },
      },
    ]);
    expect((row!.components[0]!.data as { emoji: unknown }).emoji).toEqual({
      id: "123456789012345678",
      name: "yes",
      animated: true,
    });
  });
});

describe("matchMembers", () => {
  const member = (id: string, displayName: string) => ({
    id,
    displayName,
    nickname: null,
    user: { globalName: null, username: displayName },
  });
  const guild = (members: ReturnType<typeof member>[]) =>
    ({
      members: {
        search: async ({ query }: { query: string }) =>
          new Map(
            members
              .filter((m) => m.displayName.toLowerCase().includes(query.toLowerCase()))
              .map((m) => [m.id, m]),
          ),
      },
    }) as unknown as Guild;

  const input: StoredEvent = {
    ...event,
    responses: {
      ...event.responses,
      accepted: [{ displayName: "alice" }, { displayName: "Sam" }, { displayName: "Nobody" }],
    },
  };

  it("matches exact names and skips ambiguous or unknown ones", async () => {
    const result = await matchMembers(
      guild([
        member("1", "Alice"),
        member("5", "Sam"),
        member("6", "sam"),
        member("7", "Samantha"),
      ]),
      input,
    );
    expect(result.responses.accepted).toEqual([
      { displayName: "alice", discordUserId: "1" },
      { displayName: "Sam" },
      { displayName: "Nobody" },
    ]);
  });
});

describe("readEvent", () => {
  const apolloEmbed = (names: string) => ({
    title: "Scrim",
    fields: [{ name: "Accepted (1)", value: names }],
  });
  const toEmbed = (data: object) => ({ toJSON: () => data });

  it("sees sign-ups added since the message was first read", async () => {
    // Behaves as discord.js does: a cached message is returned unless a fresh one is forced.
    let current = apolloEmbed("Alice");
    let cached: { embeds: ReturnType<typeof toEmbed>[] } | undefined;
    const fetch = async ({ force }: { force?: boolean }) => {
      if (!force && cached) return cached;
      cached = { embeds: [toEmbed(current)] };
      return cached;
    };
    const client = {
      channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch } }) },
    } as unknown as Client;
    const location = { guildId: "g", channelId: "c", messageId: "m" };

    await readEvent(client, location);
    current = apolloEmbed("Bob");
    const { responses } = await readEvent(client, location);
    expect(responses.accepted.map((p) => p.displayName)).toContain("Bob");
  });
});

describe("assertCanPost", () => {
  const interaction = (flags: bigint[], isThread = false) =>
    ({
      appPermissions: new PermissionsBitField(flags),
      channel: { isThread: () => isThread },
    }) as unknown as BaseInteraction;
  const {
    ViewChannel,
    SendMessages,
    SendMessagesInThreads,
    EmbedLinks,
    AttachFiles,
    ReadMessageHistory,
  } = PermissionFlagsBits;
  const shared = [ViewChannel, EmbedLinks, AttachFiles, ReadMessageHistory];

  it("allows a channel with everything the roster needs", () => {
    expect(() => assertCanPost(interaction([...shared, SendMessages]))).not.toThrow();
  });

  it("names exactly what is missing", () => {
    expect(() =>
      assertCanPost(interaction([ViewChannel, SendMessages, ReadMessageHistory])),
    ).toThrow(/It needs: Embed Links, Attach Files\./);
  });

  it("asks for the thread permission inside a thread", () => {
    expect(() =>
      assertCanPost(interaction([...shared, SendMessagesInThreads], true)),
    ).not.toThrow();
    expect(() => assertCanPost(interaction([...shared, SendMessages], true))).toThrow(
      /Send Messages in Threads/,
    );
  });
});

describe("postFailure", () => {
  const refusal = (code: number, status: number) =>
    new DiscordAPIError({ code, message: "No" }, code, status, "POST", "https://x", {});

  it("explains the access error production hit", () => {
    const error = postFailure(refusal(50001, 403));
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toContain("View Channel");
  });

  it("says when Discord itself is failing, and names an unknown refusal", () => {
    expect((postFailure(refusal(0, 503)) as Error).message).toContain("not responding");
    expect((postFailure(refusal(12345, 400)) as Error).message).toContain("12345");
  });

  it("leaves other errors to the router, which logs them", () => {
    const bug = new Error("bug");
    expect(postFailure(bug)).toBe(bug);
  });
});

describe("startingText", () => {
  it("shows a progress bar once the player count is known", () => {
    expect(startingText()).toContain("Starting the roster builder");
    expect(startingText()).not.toContain("Matching");
    expect(startingText(5, 10)).toContain("`▰▰▰▰▰▱▱▱▱▱` Matching players to Discord: 5 of 10");
  });
});
