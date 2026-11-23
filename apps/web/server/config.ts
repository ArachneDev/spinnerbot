import { readFileSync } from "node:fs";
import { z } from "zod";

const schema = z.object({
  databaseUrl: z.string({ error: "Set DATABASE_URL_FILE (or DATABASE_URL in development)" }).min(1),
  port: z.coerce.number().int().default(3000),
  logLevel: z.string().default("info"),
});

export type WebConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const file = env["DATABASE_URL_FILE"];
  return schema.parse({
    databaseUrl: file ? readFileSync(file, "utf8").trim() : env["DATABASE_URL"],
    port: env["PORT"] || undefined,
    logLevel: env["LOG_LEVEL"] || undefined,
  });
}
