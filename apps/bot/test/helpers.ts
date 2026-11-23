import type { DatabaseHandle } from "@scrimbot/db";
import { type Client, type Interaction, MessageFlags, MessageFlagsBitField } from "discord.js";
import { pino } from "pino";
import { vi } from "vitest";
import type { FeatureContext } from "../src/framework/types.js";

export function fakeContext(): FeatureContext {
  return {
    client: {} as Client,
    database: {} as DatabaseHandle,
    log: pino({ level: "silent" }),
    python: { run: vi.fn() },
    publicUrl: "http://localhost:3000",
  };
}

interface FakeOptions {
  kind: "command" | "component";
  commandName?: string;
  customId?: string;
  allowed?: boolean;
  /** For a component: whether the message it is on is private, and that message's text. */
  ephemeral?: boolean;
  content?: string;
}

/** A stand-in with the interaction methods the router uses. No Discord connection needed. */
export function fakeInteraction({
  kind,
  commandName,
  customId,
  allowed = true,
  ephemeral = false,
  content = "",
}: FakeOptions) {
  const interaction = {
    commandName,
    customId,
    deferred: false,
    guildId: "100000000000000001",
    message: {
      content,
      flags: new MessageFlagsBitField(ephemeral ? MessageFlags.Ephemeral : 0),
    },
    replied: false,
    user: { id: "user-1" },
    memberPermissions: { has: () => allowed },
    isChatInputCommand: () => kind === "command",
    isMessageComponent: () => kind === "component",
    isModalSubmit: () => false,
    reply: vi.fn(async () => {
      interaction.replied = true;
    }),
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply: vi.fn(async () => {}),
    followUp: vi.fn(async () => ({ id: "follow-up" })),
    update: vi.fn(async () => {
      interaction.replied = true;
    }),
    deleteReply: vi.fn(async () => {}),
  };
  return interaction as typeof interaction & Interaction;
}
