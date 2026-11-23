import { PermissionFlagsBits } from "discord.js";
import { defineCommand } from "../../framework/command.js";
import { UserFacingError } from "../../framework/errors.js";
import { addStaffRole, removeStaffRole, staffRoleIds } from "../../framework/staff-roles.js";
import type { Feature } from "../../framework/types.js";

/** Staff can use every command. Only admins decide who is staff, so staff can't add themselves. */
export const staffRolesFeature: Feature = {
  name: "staff-roles",
  commands: [
    defineCommand({
      name: "staff-roles",
      description: "Choose the roles that may use every command. Admins only",
      options: {
        action: {
          type: "string",
          description: "What to do",
          required: true,
          choices: [
            { name: "add", value: "add" },
            { name: "remove", value: "remove" },
            { name: "list", value: "list" },
          ],
        },
        role: { type: "role", description: "The role to add or remove" },
      },
      defaultMemberPermissions: PermissionFlagsBits.Administrator,
      requiredPermissions: PermissionFlagsBits.Administrator,
      async execute(interaction, { action, role }, { database: { db } }) {
        const guildId = interaction.guildId;
        if (!guildId) throw new UserFacingError("Use this command in a server.");

        if (action === "list") {
          const ids = await staffRoleIds(db, guildId);
          await interaction.editReply({
            content: ids.length
              ? `Staff roles, besides admins: ${ids.map((id) => `<@&${id}>`).join(" ")}`
              : "No staff roles are set. Only admins can use the commands.",
            allowedMentions: { parse: [] },
          });
          return;
        }

        if (!role) throw new UserFacingError(`Choose the role to ${action}.`);
        // Every member has @everyone, whose ID is the server's. Adding it would make everyone staff.
        if (role.id === guildId) throw new UserFacingError("@everyone can't be a staff role.");

        const mention = `<@&${role.id}>`;
        const changed =
          action === "add"
            ? await addStaffRole(db, guildId, role.id)
            : await removeStaffRole(db, guildId, role.id);
        const text =
          action === "add"
            ? changed
              ? `${mention} is now a staff role.`
              : `${mention} was already a staff role.`
            : changed
              ? `${mention} is no longer a staff role.`
              : `${mention} was not a staff role.`;
        await interaction.editReply({ content: text, allowedMentions: { parse: [] } });
      },
    }),
  ],
};
