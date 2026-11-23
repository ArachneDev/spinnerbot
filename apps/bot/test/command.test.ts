import { ChannelType, InteractionContextType, PermissionFlagsBits } from "discord.js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { STAFF_VISIBILITY } from "../src/command-access.js";
import {
  type AttachmentInput,
  type ChannelInput,
  type MentionableInput,
  type RoleInput,
  type UserInput,
  defineCommand,
  readInput,
} from "../src/framework/command.js";
import { fakeContext } from "./helpers.js";

type Json = {
  options: { name: string; type: number; required?: boolean; choices?: unknown[] }[];
  contexts?: number[];
  default_member_permissions?: string;
};

const json = (command: ReturnType<typeof defineCommand>) => command.data.toJSON() as Json;
const execute = async () => {};

/** A stand-in for interaction.options, keyed by input name. */
function options(values: Record<string, object>) {
  return {
    options: {
      get: (name: string, required?: boolean) => {
        if (!values[name] && required) throw new Error(`Missing ${name}`);
        return values[name] ?? null;
      },
    },
  } as never;
}

describe("command definition", () => {
  it("registers every input form with Discord's type numbers", () => {
    const command = defineCommand({
      name: "all",
      description: "test",
      options: {
        text: { type: "string", description: "d" },
        whole: { type: "integer", description: "d" },
        decimal: { type: "number", description: "d" },
        flag: { type: "boolean", description: "d" },
        who: { type: "user", description: "d" },
        where: { type: "channel", description: "d" },
        role: { type: "role", description: "d" },
        either: { type: "mentionable", description: "d" },
        file: { type: "attachment", description: "d" },
      },
      execute,
    });
    expect(json(command).options.map((o) => [o.name, o.type])).toEqual([
      ["text", 3],
      ["whole", 4],
      ["decimal", 10],
      ["flag", 5],
      ["who", 6],
      ["where", 7],
      ["role", 8],
      ["either", 9],
      ["file", 11],
    ]);
  });

  it("marks required inputs and lists them first, as Discord demands", () => {
    const command = defineCommand({
      name: "order",
      description: "test",
      options: {
        optional: { type: "string", description: "d" },
        needed: { type: "string", description: "d", required: true },
      },
      execute,
    });
    expect(json(command).options.map((o) => [o.name, o.required])).toEqual([
      ["needed", true],
      ["optional", false],
    ]);
  });

  it("passes choices and limits to Discord", () => {
    const command = defineCommand({
      name: "limits",
      description: "test",
      options: {
        map: {
          type: "string",
          description: "d",
          choices: [{ name: "Omaha", value: "omaha" }],
        },
        size: { type: "integer", description: "d", min: 2, max: 9 },
        note: { type: "string", description: "d", minLength: 1, maxLength: 50 },
        where: { type: "channel", description: "d", channelTypes: [ChannelType.GuildText] },
      },
      execute,
    });
    expect(json(command).options).toEqual([
      expect.objectContaining({
        name: "map",
        choices: [expect.objectContaining({ value: "omaha" })],
      }),
      expect.objectContaining({ name: "size", min_value: 2, max_value: 9 }),
      expect.objectContaining({ name: "note", min_length: 1, max_length: 50 }),
      expect.objectContaining({ name: "where", channel_types: [ChannelType.GuildText] }),
    ]);
  });

  it("works only in servers unless DMs are allowed", () => {
    const base = { description: "test", execute };
    expect(json(defineCommand({ name: "a", ...base })).contexts).toEqual([
      InteractionContextType.Guild,
    ]);
    expect(json(defineCommand({ name: "b", allowInDms: true, ...base })).contexts).toBeUndefined();
  });

  it("sets who sees the command by default", () => {
    const command = defineCommand({
      name: "a",
      description: "test",
      defaultMemberPermissions: PermissionFlagsBits.ManageEvents,
      execute,
    });
    expect(json(command).default_member_permissions).toBe(String(PermissionFlagsBits.ManageEvents));
  });

  it("hides a command from regular members unless told otherwise", () => {
    const command = defineCommand({ name: "a", description: "test", execute });
    expect(json(command).default_member_permissions).toBe(String(STAFF_VISIBILITY));
  });

  it("defers privately by default", () => {
    expect(defineCommand({ name: "a", description: "test", execute }).defer).toBe("ephemeral");
  });

  it.each(["Has Spaces", "UPPER", ""])("rejects the invalid name %j at startup", (name) => {
    expect(() => defineCommand({ name, description: "test", execute })).toThrow();
  });

  it("types input from the list of options", () => {
    defineCommand({
      name: "typed",
      description: "test",
      options: {
        text: { type: "string", description: "d", required: true },
        pick: {
          type: "string",
          description: "d",
          required: true,
          choices: [
            { name: "A", value: "a" },
            { name: "B", value: "b" },
          ],
        },
        count: { type: "integer", description: "d" },
        flag: { type: "boolean", description: "d", required: true },
        who: { type: "user", description: "d", required: true },
        where: { type: "channel", description: "d", required: true },
        role: { type: "role", description: "d", required: true },
        either: { type: "mentionable", description: "d", required: true },
        file: { type: "attachment", description: "d", required: true },
      },
      async execute(_interaction, input) {
        expectTypeOf(input.text).toEqualTypeOf<string>();
        expectTypeOf(input.pick).toEqualTypeOf<"a" | "b">();
        expectTypeOf(input.count).toEqualTypeOf<number | undefined>();
        expectTypeOf(input.flag).toEqualTypeOf<boolean>();
        expectTypeOf(input.who).toEqualTypeOf<UserInput>();
        expectTypeOf(input.where).toEqualTypeOf<ChannelInput>();
        expectTypeOf(input.role).toEqualTypeOf<RoleInput>();
        expectTypeOf(input.either).toEqualTypeOf<MentionableInput>();
        expectTypeOf(input.file).toEqualTypeOf<AttachmentInput>();
      },
    });
  });
});

describe("reading input", () => {
  const user = { id: "1", username: "viper", displayName: "Viper", bot: false };

  it("returns plain JSON for every form", () => {
    const input = readInput(
      options({
        text: { value: "hi" },
        whole: { value: 3 },
        flag: { value: false },
        who: { user, member: { displayName: "Server Name" } },
        where: { channel: { id: "2", name: "scrims", type: 0, extra: "dropped" } },
        role: { role: { id: "3", name: "Leader", extra: "dropped" } },
        person: { user },
        group: { role: { id: "3", name: "Leader" } },
        file: {
          attachment: { name: "a.png", url: "https://x/a.png", contentType: "image/png", size: 5 },
        },
      }),
      {
        text: { type: "string", description: "d" },
        whole: { type: "integer", description: "d" },
        flag: { type: "boolean", description: "d" },
        who: { type: "user", description: "d" },
        where: { type: "channel", description: "d" },
        role: { type: "role", description: "d" },
        person: { type: "mentionable", description: "d" },
        group: { type: "mentionable", description: "d" },
        file: { type: "attachment", description: "d" },
      },
    );
    expect(input).toEqual({
      text: "hi",
      whole: 3,
      flag: false,
      who: { id: "1", username: "viper", displayName: "Server Name", isBot: false },
      where: { id: "2", name: "scrims", type: 0 },
      role: { id: "3", name: "Leader" },
      person: { kind: "user", id: "1", username: "viper", displayName: "Viper", isBot: false },
      group: { kind: "role", id: "3", name: "Leader" },
      file: { name: "a.png", url: "https://x/a.png", contentType: "image/png", size: 5 },
    });
    expect(JSON.parse(JSON.stringify(input))).toEqual(input);
  });

  it("leaves out optional inputs the user skipped", () => {
    const input = readInput(options({}), { note: { type: "string", description: "d" } });
    expect(input).toEqual({});
    expect("note" in input).toBe(false);
  });

  it("fails if a required input is missing", () => {
    expect(() =>
      readInput(options({}), { note: { type: "string", description: "d", required: true } }),
    ).toThrow(/Missing note/);
  });

  it("passes parsed input to the handler", async () => {
    const handler = vi.fn(async () => {});
    const command = defineCommand({
      name: "a",
      description: "test",
      options: { note: { type: "string", description: "d", required: true } },
      execute: handler,
    });
    const interaction = options({ note: { value: "hello" } });
    const context = fakeContext();
    await command.execute(interaction, context);
    expect(handler).toHaveBeenCalledWith(interaction, { note: "hello" }, context);
  });
});
