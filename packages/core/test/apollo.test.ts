import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseApolloMessage, parseMessageRef } from "../src/index.js";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/apollo/${name}.json`, import.meta.url), "utf8"));

describe("parseApolloMessage", () => {
  it("reads a single sign-up and empty lists", () => {
    const event = parseApolloMessage(fixture("event-basic"));
    expect(event.title).toBe("Scrimtest");
    expect(event.startsAt).toEqual(new Date(1793559600 * 1000));
    expect(event.responses.accepted.map((p) => p.displayName)).toEqual(["Organizer"]);
    expect(event.responses.declined).toEqual([]);
    expect(event.responses.tentative).toEqual([]);
    expect(event.complete).toBe(true);
  });

  it("reads several sign-ups across lists", () => {
    const event = parseApolloMessage(fixture("event-multi"));
    expect(event.responses.accepted.map((p) => p.displayName)).toEqual([
      "Player One",
      "Apollo",
      "okeybot",
      "InterChat",
      "Carl-bot",
      "Player Two",
      "Non-discord-user",
      "testuser",
    ]);
    expect(event.responses.declined.map((p) => p.displayName)).toEqual(["Organizer"]);
    expect(event.complete).toBe(true);
  });

  it("marks the snapshot incomplete when the header count disagrees", () => {
    const message = fixture("event-multi");
    message.embeds[0].fields[2].name = "<:accepted:1> Accepted (9)";
    expect(parseApolloMessage(message).complete).toBe(false);
  });

  it("rejects messages without an event embed", () => {
    expect(() => parseApolloMessage({ embeds: [] })).toThrow();
  });
});

describe("parseMessageRef", () => {
  const here = { guildId: "1", channelId: "2" };
  it("parses links and bare IDs", () => {
    expect(parseMessageRef("https://discord.com/channels/10/20/30", here)).toEqual({
      guildId: "10",
      channelId: "20",
      messageId: "30",
    });
    expect(parseMessageRef("100000000000000004", here)).toEqual({
      guildId: "1",
      channelId: "2",
      messageId: "100000000000000004",
    });
    expect(parseMessageRef("nope", here)).toBeUndefined();
  });
});
