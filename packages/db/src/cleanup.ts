import { lt } from "drizzle-orm";
import type { Database } from "./client.js";
import { rosterInstances } from "./schema.js";

/**
 * Deletes rosters past their expiry, and their answers with them. Messages already posted stay in
 * Discord, and their buttons then say the roster is no longer active.
 */
export async function purgeExpiredRosters(db: Database): Promise<number> {
  const rows = await db
    .delete(rosterInstances)
    .where(lt(rosterInstances.expiresAt, new Date()))
    .returning({ id: rosterInstances.id });
  return rows.length;
}
