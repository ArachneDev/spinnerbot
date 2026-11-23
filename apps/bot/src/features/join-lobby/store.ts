import { eq, inArray } from "drizzle-orm";
import { parseSteamRef, type SteamProfilePage } from "@scrimbot/core";
import { schema, type Database } from "@scrimbot/db";
import { UserFacingError } from "../../framework/errors.js";
import type { SteamClient } from "./steam.js";

const { steamProfiles: table } = schema;

export async function steamIdOf(db: Database, discordUserId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ steamId: table.steamId })
    .from(table)
    .where(eq(table.discordUserId, discordUserId));
  return row?.steamId;
}

/** Linked accounts by Discord user ID. Members without one are absent. */
export async function steamIdsOf(db: Database, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.select().from(table).where(inArray(table.discordUserId, userIds));
  return new Map(rows.map((row) => [row.discordUserId, row.steamId]));
}

export async function allSteamLinks(db: Database) {
  return db
    .select({ discordUserId: table.discordUserId, steamId: table.steamId })
    .from(table)
    .orderBy(table.createdAt);
}

/** Checks what the user pasted against Steam, then links it to them, replacing any earlier link. */
export async function linkSteamProfile(
  db: Database,
  steam: SteamClient,
  discordUserId: string,
  text: string,
): Promise<SteamProfilePage> {
  const ref = parseSteamRef(text);
  if (!ref) {
    throw new UserFacingError(
      "That is not a valid Steam profile. Enter a link such as `https://steamcommunity.com/id/yourname/`, or your friend code.",
    );
  }
  const check = await steam.check(ref);
  if (check.status === "unavailable") {
    throw new UserFacingError("Steam is not responding. Please try again in a minute.");
  }
  if (check.status === "missing") {
    throw new UserFacingError(
      "No Steam profile was found at that address. Check the link and try again.",
    );
  }

  const { steamId } = check.page;
  const [owner] = await db
    .select({ discordUserId: table.discordUserId })
    .from(table)
    .where(eq(table.steamId, steamId));
  if (owner && owner.discordUserId !== discordUserId) {
    throw new UserFacingError(
      "That Steam profile is already linked to another member. Contact an admin if it is yours.",
    );
  }

  await db
    .insert(table)
    .values({ discordUserId, steamId })
    .onConflictDoUpdate({
      target: table.discordUserId,
      set: { steamId, updatedAt: new Date() },
    });
  return check.page;
}
