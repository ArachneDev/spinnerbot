import { PermissionFlagsBits } from "discord.js";

// Who may use which slash command. Change this file and deploy.
//
// Every command is for server admins and the server's staff roles (set with /staff-roles, kept in
// the database), unless it's listed in PUBLIC_COMMANDS.
// This covers slash commands only: buttons on a message already posted work for whoever sees them.

/** Commands any member may use, by name, such as "join-lobby". A typo here fails the tests. */
export const PUBLIC_COMMANDS: readonly string[] = [];

/**
 * Discord can only hide a command by permission, not by role, and the bot's token can't set
 * per-role overrides. Few roles other than the staff ones hold this one. Those members see
 * restricted commands and are refused when they use them.
 */
export const STAFF_VISIBILITY = PermissionFlagsBits.ModerateMembers;
