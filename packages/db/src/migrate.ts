import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./client.js";

/** Applies pending migrations. Run with the owner role, never the bot or web role. */
export async function runMigrations(url: string): Promise<void> {
  const { db, sql } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
    });
  } finally {
    await sql.end();
  }
}
