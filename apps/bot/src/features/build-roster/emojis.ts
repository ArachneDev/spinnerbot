import { eq } from "drizzle-orm";
import type { EmojiCache } from "@scrimbot/core";
import { schema } from "@scrimbot/db";
import type { FeatureContext } from "../../framework/types.js";

const { rosterInstances: table } = schema;
/** Opening the editor again soon after is served from what we already saved. */
const MIN_GAP_MS = 30_000;
const lastLoad = new Map<string, number>();

/**
 * Saves the server's emoji for the web page's button editor. The web app can't ask Discord, so it
 * queues this job when the leader opens the editor, and the list is only fetched then.
 */
export async function refreshEmojis(
  { client, database: { db } }: FeatureContext,
  id: string,
): Promise<void> {
  if (Date.now() - (lastLoad.get(id) ?? 0) < MIN_GAP_MS) return;
  const [row] = await db.select().from(table).where(eq(table.id, id));
  if (!row) return;
  lastLoad.set(id, Date.now());

  const guild = await client.guilds.fetch(row.guildId);
  const found = await guild.emojis.fetch();
  const cache: EmojiCache = {
    loadedAt: new Date().toISOString(),
    emojis: [...found.values()]
      .filter((e) => e.id && e.name && e.available !== false)
      .map((e) => ({ id: e.id!, name: e.name!, ...(e.animated ? { animated: true } : {}) })),
  };
  await db.update(table).set({ emojiOptions: cache }).where(eq(table.id, id));
}
