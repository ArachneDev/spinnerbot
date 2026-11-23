import postgres from "postgres";
import { runMigrations } from "./migrate.js";

/**
 * Run by the bot on every start with the owner role: applies migrations, then sets the web's and
 * bot's passwords from their connection URLs, so each secret stays the single place a password
 * lives. Safe to repeat. Migration 0001 creates the two roles without a login.
 */
export async function prepareDatabase(urls: {
  owner: string;
  web: string;
  bot: string;
}): Promise<void> {
  await runMigrations(urls.owner);
  const sql = postgres(urls.owner, { max: 1, onnotice: () => {} });
  try {
    for (const [role, url] of [
      ["scrimbot_web", urls.web],
      ["scrimbot_bot", urls.bot],
    ] as const) {
      const password = decodeURIComponent(new URL(url).password);
      const [statement] = await sql<{ text: string }[]>`
        select format('alter role %I login password %L', ${role}::text, ${password}::text) as text
      `;
      await sql.unsafe(statement!.text);
    }
  } finally {
    await sql.end();
  }
}
