import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const SECRETS_FILE = "/run/secrets/app.json";

/**
 * The app's secrets. In production the platform mounts them as one JSON file. In development there
 * is no such file, and the same names come from .env. The values stay in this object and go only
 * to the code that needs them; they are never put in process.env.
 */
export function loadAppSecrets(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const file = env["APP_SECRETS_FILE"] || SECRETS_FILE;
  if (!existsSync(file)) return {};
  try {
    return z.record(z.string(), z.string()).parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    throw new Error(`${file} must be a JSON object of strings`);
  }
}

/** A secret from the app secrets file, or else from the environment (development). */
export function appSecret(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  secrets: Record<string, string> = loadAppSecrets(env),
): string | undefined {
  return secrets[name] || env[name] || undefined;
}

/** Reads NAME, or the file at NAME_FILE, which is how Podman secrets arrive. */
function fileSecret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const file = env[`${name}_FILE`];
  return file ? readFileSync(file, "utf8").trim() : env[name] || undefined;
}

const required = (message: string) => z.string({ error: message }).min(1, message);

const schema = z
  .object({
    discordToken: required(
      "Set DISCORD_TOKEN in /run/secrets/app.json (or in .env for development)",
    ),
    applicationId: required("Set DISCORD_APPLICATION_ID"),
    devGuildId: z.string().optional(),
    publicUrl: required("Set PUBLIC_URL, the web app address used in roster links"),
    databaseUrl: required("Set DATABASE_URL_FILE (or DATABASE_URL in development)"),
    /** With these two, the bot migrates the database and sets both roles' passwords on start. */
    ownerDatabaseUrl: z.string().optional(),
    webDatabaseUrl: z.string().optional(),
    logLevel: z.string().default("info"),
    pythonBin: z.string().optional(),
  })
  .refine((c) => !c.ownerDatabaseUrl || c.webDatabaseUrl, {
    message:
      "DATABASE_OWNER_URL_FILE needs DATABASE_WEB_URL_FILE too, to set the web role's password",
    path: ["webDatabaseUrl"],
  });

export type BotConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  return schema.parse({
    discordToken: appSecret("DISCORD_TOKEN", env),
    applicationId: env["DISCORD_APPLICATION_ID"],
    devGuildId: env["DISCORD_DEV_GUILD_ID"] || undefined,
    publicUrl: env["PUBLIC_URL"]?.replace(/\/+$/, ""),
    databaseUrl: fileSecret(env, "DATABASE_URL"),
    ownerDatabaseUrl: fileSecret(env, "DATABASE_OWNER_URL"),
    webDatabaseUrl: fileSecret(env, "DATABASE_WEB_URL"),
    logLevel: env["LOG_LEVEL"] || undefined,
    pythonBin: env["PYTHON_BIN"] || undefined,
  });
}
