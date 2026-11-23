import { GatewayIntentBits, SlashCommandBuilder } from "discord.js";
import { describe, expect, it } from "vitest";
import { features } from "../src/features/index.js";
import { buildRegistry, customId } from "../src/framework/registry.js";
import type { Feature, SlashCommand } from "../src/framework/types.js";

const command = (name: string): SlashCommand => ({
  data: new SlashCommandBuilder().setName(name).setDescription("test"),
  defer: "none",
  execute: async () => {},
});

describe("buildRegistry", () => {
  it("accepts the real feature list", () => {
    const registry = buildRegistry(features);
    expect(registry.commands.has("ping")).toBe(true);
    expect(registry.jobs.has("system.heartbeat")).toBe(true);
  });

  it("requests only the intents features declare", () => {
    const base: Feature = { name: "base" };
    const extra: Feature = { name: "extra", intents: [GatewayIntentBits.GuildMembers] };
    expect(buildRegistry([base]).intents).toEqual([GatewayIntentBits.Guilds]);
    expect(buildRegistry([base, extra]).intents).toContain(GatewayIntentBits.GuildMembers);
  });

  it.each<[string, Feature[], RegExp]>([
    ["duplicate features", [{ name: "a" }, { name: "a" }], /Duplicate feature/],
    ["bad feature names", [{ name: "Bad:Name" }], /must match/],
    [
      "commands in two features",
      [
        { name: "a", commands: [command("x")] },
        { name: "b", commands: [command("x")] },
      ],
      /both a and b/,
    ],
    [
      "duplicate components",
      [
        {
          name: "a",
          components: [
            { action: "go", execute: async () => {} },
            { action: "go", execute: async () => {} },
          ],
        },
      ],
      /Duplicate component/,
    ],
    [
      "actions containing the separator",
      [{ name: "a", components: [{ action: "go:now", execute: async () => {} }] }],
      /must match/,
    ],
    [
      "unlisted job types",
      [{ name: "a", jobs: [{ type: "nope", execute: async () => {} }] }],
      /Unknown job type/,
    ],
  ])("rejects %s", (_label, input, message) => {
    expect(() => buildRegistry(input)).toThrow(message);
  });
});

describe("customId", () => {
  it("builds the routed format and enforces Discord's limit", () => {
    expect(customId("a", "go", "1", "2")).toBe("a:go:1:2");
    expect(() => customId("a", "go", "x".repeat(100))).toThrow(/100 character/);
  });
});
