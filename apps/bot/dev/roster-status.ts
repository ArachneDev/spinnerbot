import { readFileSync } from "node:fs";
import { REST, Routes, type APIMessage } from "discord.js";
import { desc, eq } from "drizzle-orm";
import { createDatabase, schema } from "@scrimbot/db";

// Dev tool: shows the newest roster as the database and Discord hold it, so a person clicking
// through the flow can have each step checked. Private messages (the preview, the prompts) can't
// be read by a bot, so those are for the person to report.
// Usage: pnpm --filter @scrimbot/bot roster:status

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("Set DATABASE_URL");
const creds = Object.fromEntries(
  readFileSync(new URL("../../../testerBot/testerBot_creds", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const { db, sql } = createDatabase(url);
const { rosterInstances: instances, rosterResponses: responses } = schema;
const [row] = await db.select().from(instances).orderBy(desc(instances.createdAt)).limit(1);
if (!row) {
  console.log("No rosters yet.");
  await sql.end();
  process.exit(0);
}

const options = row.answerOptions as { key: string; label: string; emoji?: { name: string } }[];
const label = (key: string) => options.find((o) => o.key === key)?.label ?? `(removed: ${key})`;
const assignments = row.assignments as Record<string, number>;
const squads = new Map<number, number>();
for (const squad of Object.values(assignments)) squads.set(squad, (squads.get(squad) ?? 0) + 1);

console.log(`Roster ${row.id}`);
console.log(`  status:        ${row.status}`);
console.log(
  `  created:       ${row.createdAt.toISOString()}   expires: ${row.expiresAt.toISOString()}`,
);
console.log(
  `  buttons:       ${options.map((o) => `${o.emoji?.name ?? ""} ${o.label}`.trim()).join(" | ")}`,
);
console.log(
  `  squads:        ${
    [...squads]
      .sort()
      .map(([n, c]) => `${n}:${c}`)
      .join(" ") || "(none)"
  }`,
);
console.log(`  live preview:  ${row.previewToken ? "token held" : "no token"}`);
console.log(`  posted msg:    ${row.postedMessageId ?? "(not posted)"}`);
if (row.postedAnswerOptions) {
  const posted = row.postedAnswerOptions as typeof options;
  console.log(`  posted buttons: ${posted.map((o) => o.label).join(" | ")}`);
}

const answers = await db.select().from(responses).where(eq(responses.instanceId, row.id));
console.log(
  `  answers:       ${answers.map((a) => `${a.userId}=${label(a.answer)}`).join(", ") || "(none)"}`,
);

if (row.postedMessageId) {
  const tester = new REST().setToken(creds["TOKEN"] ?? "");
  try {
    const m = (await tester.get(
      Routes.channelMessage(row.channelId, row.postedMessageId),
    )) as APIMessage;
    const embed = m.embeds[0];
    console.log("\nPosted message in Discord:");
    console.log(`  title:       ${embed?.title}`);
    console.log(`  description: ${embed?.description?.replaceAll("\n", " / ")}`);
    for (const f of embed?.fields ?? [])
      console.log(`  ${f.name}: ${f.value.replaceAll("\n", " / ")}`);
    for (const r of (m.components ?? []) as {
      components: { label?: string; custom_id?: string }[];
    }[]) {
      console.log(`  buttons:     ${r.components.map((c) => c.label).join(" | ")}`);
    }
    console.log(`  reactions:   ${(m.reactions ?? []).length}`);
  } catch (error) {
    console.log(
      `\nPosted message could not be read: ${error instanceof Error ? error.message : error}`,
    );
  }
}
await sql.end();
