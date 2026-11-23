import { z } from "zod";
import { defineCommand } from "../../framework/command.js";
import type { Feature } from "../../framework/types.js";

const resultSchema = z.object({ rolls: z.array(z.number()), total: z.number() });

/** An example of a command whose logic is in Python: see python/commands/roll.py. */
export const rollFeature: Feature = {
  name: "roll",
  commands: [
    defineCommand({
      name: "roll",
      description: "Roll some dice",
      options: {
        sides: {
          type: "integer",
          description: "Sides on each die",
          required: true,
          min: 2,
          max: 1000,
        },
        count: { type: "integer", description: "How many dice (default 1)", min: 1, max: 20 },
      },
      async execute(interaction, input, { python }) {
        const { rolls, total } = await python.run("roll", input, resultSchema);
        await interaction.editReply(`Rolled ${rolls.join(", ")}. Total: ${total}.`);
      },
    }),
  ],
};
