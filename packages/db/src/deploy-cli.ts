import { readFileSync } from "node:fs";
import postgres from "postgres";
import { runMigrations } from "./migrate.js";

// Run on each deploy with the owner role: applies migrations, then sets the bot's and web's
// passwords from their connection URLs, so each secret stays the single place a password lives.
const read = (file: string) => readFileSync(file, "utf8").trim();

const ownerUrl = read("/run/secrets/db_owner_url");
await runMigrations(ownerUrl);

const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
try {
  for (const [role, file] of [
    ["scrimbot_web", "/run/secrets/web_db_url"],
    ["scrimbot_bot", "/run/secrets/bot_db_url"],
  ] as const) {
    const password = decodeURIComponent(new URL(read(file)).password);
    const [statement] = await sql<{ text: string }[]>`
      select format('alter role %I login password %L', ${role}::text, ${password}::text) as text
    `;
    await sql.unsafe(statement!.text);
  }
} finally {
  await sql.end();
}
console.log("Database ready");
