import { readFileSync } from "node:fs";
import { z } from "zod";

/** Reads NAME, or the file at NAME_FILE, which is how Podman secrets arrive. */
function secret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const file = env[`${name}_FILE`];
  return file ? readFileSync(file, "utf8").trim() : env[name];
}

const required = (message: string) => z.string({ error: message }).min(1, message);

const schema = z.object({
  discordToken: required("Set DISCORD_TOKEN or DISCORD_TOKEN_FILE"),
  applicationId: required("Set DISCORD_APPLICATION_ID"),
  devGuildId: z.string().optional(),
  publicUrl: required("Set PUBLIC_URL, the web app address used in roster links"),
  databaseUrl: required("Set DATABASE_URL or DATABASE_URL_FILE"),
  logLevel: z.string().default("info"),
  pythonBin: z.string().optional(),
});

export type BotConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  return schema.parse({
    discordToken: secret(env, "DISCORD_TOKEN"),
    applicationId: env["DISCORD_APPLICATION_ID"],
    devGuildId: env["DISCORD_DEV_GUILD_ID"] || undefined,
    publicUrl: env["PUBLIC_URL"]?.replace(/\/+$/, ""),
    databaseUrl: secret(env, "DATABASE_URL"),
    logLevel: env["LOG_LEVEL"] || undefined,
    pythonBin: env["PYTHON_BIN"] || undefined,
  });
}
