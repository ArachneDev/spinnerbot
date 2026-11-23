import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@scrimbot/db";

const { staffRoles: table } = schema;

/** The roles a server's admins have made staff, besides the admins themselves. */
export async function staffRoleIds(db: Database, guildId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: table.roleId })
    .from(table)
    .where(eq(table.guildId, guildId))
    .orderBy(table.createdAt);
  return rows.map((row) => row.roleId);
}

/** Returns false when the role was already staff. */
export async function addStaffRole(db: Database, guildId: string, roleId: string) {
  const rows = await db
    .insert(table)
    .values({ guildId, roleId })
    .onConflictDoNothing()
    .returning({ roleId: table.roleId });
  return rows.length > 0;
}

/** Returns false when the role was not staff. */
export async function removeStaffRole(db: Database, guildId: string, roleId: string) {
  const rows = await db
    .delete(table)
    .where(and(eq(table.guildId, guildId), eq(table.roleId, roleId)))
    .returning({ roleId: table.roleId });
  return rows.length > 0;
}
