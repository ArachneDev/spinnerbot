import { PermissionFlagsBits, PermissionsBitField, type BaseInteraction } from "discord.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANSWER_OPTIONS, type StoredEvent } from "@scrimbot/core";
import {
  PING_COOLDOWN_MS,
  PING_TEXT,
  pendingPlayers,
  pingAllowedAt,
  pingMessages,
  startPingCooldown,
  threadProblem,
} from "../src/features/build-roster/ping.js";

const event: StoredEvent = {
  title: "Scrim",
  complete: true,
  responses: {
    accepted: [
      { displayName: "Alice", discordUserId: "1" },
      { displayName: "Bob", discordUserId: "2" },
      { displayName: "Cara", discordUserId: "3" },
      { displayName: "Ghost" },
      { displayName: "Benched", discordUserId: "5" },
    ],
    declined: [],
    tentative: [],
  },
};
// Everyone but Benched is in a squad.
const assignments = { "0": 1, "1": 1, "2": 2, "3": 2 };
const names = (people: { displayName: string }[]) => people.map((p) => p.displayName);

describe("pendingPlayers", () => {
  it("lists squad players with no answer, leaving out the bench", () => {
    const { pingable, unmatched } = pendingPlayers(
      event,
      assignments,
      new Map([["1", "confirmed"]]),
      DEFAULT_ANSWER_OPTIONS,
    );
    expect(names(pingable)).toEqual(["Bob", "Cara"]);
    expect(names(unmatched)).toEqual(["Ghost"]);
  });

  it("counts an answer whose button was removed as no answer", () => {
    const { pingable } = pendingPlayers(
      event,
      assignments,
      new Map([
        ["1", "confirmed"],
        ["2", "gone"],
      ]),
      DEFAULT_ANSWER_OPTIONS,
    );
    expect(names(pingable)).toEqual(["Bob", "Cara"]);
  });

  it("is empty when every listed player answered", () => {
    const answers = new Map([
      ["1", "confirmed"],
      ["2", "denied"],
      ["3", "confirmed"],
    ]);
    const { pingable } = pendingPlayers(event, assignments, answers, DEFAULT_ANSWER_OPTIONS);
    expect(pingable).toEqual([]);
  });
});

describe("pingMessages", () => {
  it("puts the line, then the mentions, and mentions only those users", () => {
    expect(pingMessages(["1", "2", "2"])).toEqual([
      { content: `${PING_TEXT}\n<@1> <@2>`, users: ["1", "2"] },
    ]);
  });

  it("splits under 2000 characters, each message naming its own users", () => {
    const ids = Array.from({ length: 150 }, (_, i) => String(100000000000000000n + BigInt(i)));
    const messages = pingMessages(ids);
    expect(messages.length).toBeGreaterThan(1);
    for (const { content, users } of messages) {
      expect(content.length).toBeLessThanOrEqual(2000);
      expect(users.length).toBeLessThanOrEqual(100);
      expect(content.match(/<@\d+>/g)).toEqual(users.map((id) => `<@${id}>`));
    }
    expect(messages.flatMap((m) => m.users)).toEqual(ids);
    expect(messages[0]!.content.startsWith(PING_TEXT)).toBe(true);
  });
});

describe("threadProblem", () => {
  const interaction = (flags: bigint[], isThread = false) =>
    ({
      appPermissions: new PermissionsBitField(flags),
      channel: { isThread: () => isThread },
    }) as unknown as BaseInteraction;
  const { CreatePublicThreads, SendMessagesInThreads } = PermissionFlagsBits;

  it("is nothing when the bot can start and use threads", () => {
    expect(threadProblem(interaction([CreatePublicThreads, SendMessagesInThreads]))).toBe(
      undefined,
    );
  });

  it("names the missing thread permissions", () => {
    expect(threadProblem(interaction([SendMessagesInThreads]))).toContain(
      "It needs: Create Public Threads.",
    );
  });

  it("replies instead when the roster is already in a thread", () => {
    expect(threadProblem(interaction([CreatePublicThreads], true))).toContain("inside a thread");
  });
});

describe("ping cooldown", () => {
  it("blocks another ping of the same roster for ten minutes", () => {
    startPingCooldown("roster-a", 0);
    expect(pingAllowedAt("roster-a", PING_COOLDOWN_MS - 1)).toEqual(new Date(PING_COOLDOWN_MS));
    expect(pingAllowedAt("roster-a", PING_COOLDOWN_MS)).toBeUndefined();
    expect(pingAllowedAt("roster-b", 1)).toBeUndefined();
  });
});
