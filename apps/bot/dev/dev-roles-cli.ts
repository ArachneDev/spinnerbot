import { createDatabase } from "@scrimbot/db";
import { type AppRole, devPassword } from "./dev-roles.js";

// Development only: lets scrimbot_bot and scrimbot_web log in with a local password.
const url = process.env["DATABASE_URL"];
if (!url) throw new Error("Set DATABASE_URL (the owner's URL, as in .env)");

const { sql } = createDatabase(url);
try {
  for (const role of ["scrimbot_bot", "scrimbot_web"] as AppRole[]) {
    const [statement] = await sql<{ text: string }[]>`
      select format('alter role %I login password %L', ${role}::text, ${devPassword(role)}::text) as text
    `;
    await sql.unsafe(statement!.text);
  }
} finally {
  await sql.end();
}
console.log("Dev roles ready: bot and web connect as scrimbot_bot and scrimbot_web");
