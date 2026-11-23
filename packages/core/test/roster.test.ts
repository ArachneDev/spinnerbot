import { describe, expect, it } from "vitest";
import {
  answerOptionsSchema,
  buildRoster,
  cleanSquadLeaders,
  embedStyleSchema,
  styleUsesOnlyKnownEmoji,
  DEFAULT_SQUAD_NAMES,
  squadNamesSchema,
  squadType,
  cleanAssignments,
  DEFAULT_ANSWER_OPTIONS,
  formatEmoji,
  listedPlayers,
  usesOnlyKnownEmoji,
  type StoredEvent,
} from "../src/index.js";

const event: StoredEvent = {
  title: "Scrim",
  complete: true,
  responses: {
    accepted: [{ displayName: "A" }, { displayName: "B" }, { displayName: "C" }],
    declined: [],
    tentative: [],
  },
};

describe("roster", () => {
  it("places players in squads and leaves the rest on the bench", () => {
    const roster = buildRoster(event, { "0": 2, "2": 2 });
    expect(roster.squads[1]!.players.map((p) => p.displayName)).toEqual(["A", "C"]);
    expect(roster.bench.map((p) => p.displayName)).toEqual(["B"]);
    expect(listedPlayers(roster)).toHaveLength(2);
  });

  it("drops assignments for players that don't exist", () => {
    expect(cleanAssignments({ "0": 1, "3": 1, "-1": 1, x: 1 }, 3)).toEqual({ "0": 1 });
  });
});

describe("answer options", () => {
  const confirm = { key: "confirmed", label: "Confirm" };

  it("accepts the defaults and server or standard emoji", () => {
    expect(answerOptionsSchema.safeParse(DEFAULT_ANSWER_OPTIONS).success).toBe(true);
    const custom = {
      key: "late",
      label: "Late",
      emoji: { id: "123456789012345678", name: "clock" },
    };
    expect(
      answerOptionsSchema.safeParse([
        confirm,
        custom,
        { key: "x", label: "Maybe", emoji: { name: "🤔" } },
      ]).success,
    ).toBe(true);
  });

  it("requires Confirm first, at most five buttons, and sane emoji", () => {
    const other = { key: "late", label: "Late" };
    expect(answerOptionsSchema.safeParse([other, confirm]).success).toBe(false);
    expect(
      answerOptionsSchema.safeParse([
        confirm,
        ...[1, 2, 3, 4, 5].map((n) => ({ key: `k${n}`, label: "x" })),
      ]).success,
    ).toBe(false);
    expect(answerOptionsSchema.safeParse([{ ...confirm, emoji: { name: "hello" } }]).success).toBe(
      false,
    );
    expect(answerOptionsSchema.safeParse([{ ...confirm, label: "" }]).success).toBe(false);
    expect(answerOptionsSchema.safeParse([confirm, confirm]).success).toBe(false);
  });

  it("only allows server emoji the bot listed", () => {
    const options = [{ ...confirm, emoji: { id: "123456789012345678", name: "clock" } }];
    expect(usesOnlyKnownEmoji(options, null)).toBe(false);
    expect(
      usesOnlyKnownEmoji(options, {
        loadedAt: "x",
        emojis: [{ id: "123456789012345678", name: "clock" }],
      }),
    ).toBe(true);
    expect(usesOnlyKnownEmoji([{ ...confirm, emoji: { name: "✅" } }], null)).toBe(true);
  });

  it("writes server emoji the way messages need them", () => {
    expect(formatEmoji({ id: "1".repeat(18), name: "wave", animated: true })).toBe(
      `<a:wave:${"1".repeat(18)}>`,
    );
    expect(formatEmoji({ name: "✅" })).toBe("✅");
  });
});

describe("squad names and leaders", () => {
  const event = {
    title: "Scrim",
    complete: true,
    responses: {
      accepted: [{ displayName: "A" }, { displayName: "B" }, { displayName: "C" }],
      declined: [],
      tentative: [],
    },
  };

  it("needs 1 to 12 names of 1 to 32 characters", () => {
    expect(squadNamesSchema.safeParse(DEFAULT_SQUAD_NAMES).success).toBe(true);
    expect(squadNamesSchema.safeParse(["One"]).success).toBe(true);
    expect(squadNamesSchema.safeParse([]).success).toBe(false);
    expect(squadNamesSchema.safeParse(Array(13).fill("x")).success).toBe(false);
    const blank = [" ", ...DEFAULT_SQUAD_NAMES.slice(1)];
    expect(squadNamesSchema.safeParse(blank).success).toBe(false);
    const long = ["x".repeat(33), ...DEFAULT_SQUAD_NAMES.slice(1)];
    expect(squadNamesSchema.safeParse(long).success).toBe(false);
  });

  it("gives a type only to squads carrying a clan name", () => {
    expect(squadType("Deadwatch")).toBe("Recon");
    expect(squadType("Alpha")).toBeUndefined();
  });

  it("names the squads and lists the leader first", () => {
    const names = ["Alpha", ...DEFAULT_SQUAD_NAMES.slice(1)];
    const { squads } = buildRoster(
      event,
      { "0": 1, "1": 1, "2": 2 },
      { squadNames: names, squadLeaders: { "1": 1 } },
    );
    expect(squads[0]!.name).toBe("Alpha");
    expect(squads[0]!.type).toBeUndefined();
    expect(squads[1]!.type).toBe("Assault");
    expect(squads[0]!.players.map((p) => p.displayName)).toEqual(["B", "A"]);
    expect(squads[0]!.leader?.displayName).toBe("B");
  });

  it("ignores and cleans a leader who isn't in the squad", () => {
    const assignments = { "0": 1, "1": 2 };
    const { squads } = buildRoster(event, assignments, { squadLeaders: { "1": 1 } });
    expect(squads[0]!.leader).toBeUndefined();
    expect(cleanSquadLeaders({ "1": 1, "2": 1 }, assignments)).toEqual({ "2": 1 });
  });

  it("treats a player in a removed squad as benched, and cleans them out", () => {
    const { squads, bench } = buildRoster(event, { "0": 3 }, { squadNames: ["A", "B"] });
    expect(squads).toHaveLength(2);
    expect(bench.map((p) => p.displayName)).toEqual(["A", "B", "C"]);
    expect(cleanAssignments({ "0": 3, "1": 2 }, 3, 2)).toEqual({ "1": 2 });
  });

  it("accepts only https pictures, known server emoji and real colours in a style", () => {
    const parse = (style: unknown) => embedStyleSchema.safeParse(style).success;
    expect(parse({ bannerUrl: "https://example.test/a.png", colour: "#E3121E" })).toBe(true);
    expect(parse({ bannerUrl: "http://example.test/a.png" })).toBe(false);
    expect(parse({ thumbnail: "crest" })).toBe(true);
    expect(parse({ colour: "red" })).toBe(false);
    const emoji = { id: "123456789012345678", name: "wolf" };
    const cache = { loadedAt: "", emojis: [emoji] };
    expect(styleUsesOnlyKnownEmoji({ squadEmojis: [emoji, null] }, cache)).toBe(true);
    expect(styleUsesOnlyKnownEmoji({ leaderEmoji: emoji }, null)).toBe(false);
    expect(styleUsesOnlyKnownEmoji({ pendingEmoji: { name: "⏳" } }, null)).toBe(true);
  });
});
