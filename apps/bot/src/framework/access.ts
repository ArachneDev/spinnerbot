import { type ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import type { Database } from "@scrimbot/db";
import { PUBLIC_COMMANDS } from "../command-access.js";
import { staffRoleIds } from "./staff-roles.js";

export function isPublicCommand(name: string): boolean {
  return PUBLIC_COMMANDS.includes(name);
}

type Who = Pick<ChatInputCommandInteraction, "guildId" | "member" | "memberPermissions">;

async function hasStaffRole({ guildId, member }: Who, db: Database): Promise<boolean> {
  if (!guildId || !member) return false;
  const { roles } = member;
  const staff = await staffRoleIds(db, guildId);
  return Array.isArray(roles)
    ? roles.some((id) => staff.includes(id))
    : staff.some((id) => roles.cache.has(id));
}

/** A server admin, or someone with one of the server's staff roles, which `/staff-roles` sets. */
export async function isStaff(interaction: Who, db: Database): Promise<boolean> {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true ||
    (await hasStaffRole(interaction, db))
  );
}

/** Checked on every use, because a server admin can change who sees a command in Discord. */
export async function mayUseCommand(
  interaction: Who & Pick<ChatInputCommandInteraction, "commandName">,
  db: Database,
): Promise<boolean> {
  return isPublicCommand(interaction.commandName) || (await isStaff(interaction, db));
}
