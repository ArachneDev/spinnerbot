import { MessageFlags } from "discord.js";
import { defineCommand } from "../../framework/command.js";
import type { Feature } from "../../framework/types.js";

export const pingFeature: Feature = {
  name: "ping",
  commands: [
    defineCommand({
      name: "ping",
      description: "Check that Spinner Bot is online",
      defer: "none",
      async execute(interaction, _input, { client }) {
        await interaction.reply({
          content: `Spinner Bot is online. Gateway latency: ${client.ws.ping} ms.`,
          flags: MessageFlags.Ephemeral,
        });
      },
    }),
  ],
};
