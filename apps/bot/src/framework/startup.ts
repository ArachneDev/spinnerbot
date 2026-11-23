import type { DatabaseHandle } from "@scrimbot/db";
import type { Logger } from "./logger.js";

/** Host, port and database of a connection URL, without the credentials. */
function describeTarget(url: string): string {
  try {
    const { hostname, port, pathname } = new URL(url);
    return `${hostname}:${port || "5432"}${pathname}`;
  } catch {
    return "(DATABASE_URL is not a valid URL)";
  }
}

/**
 * Fails fast, with a reason and a fix, when the database can't be used. The bot needs it for the
 * job queue that carries requests from the web app, so there is no useful degraded mode.
 */
export async function assertDatabaseReady(
  database: DatabaseHandle,
  databaseUrl: string,
  log: Logger,
): Promise<void> {
  const target = describeTarget(databaseUrl);
  try {
    await database.sql`select 1 from bot_jobs limit 0`;
  } catch (error) {
    const code = (error as { code?: string }).code;
    const [reason, fix] =
      code === "ECONNREFUSED"
        ? [
            `Nothing is listening at ${target}.`,
            "Start Postgres. In dev: the `podman run ... spinnerbot-dev-db` command in README.md.",
          ]
        : code === "42P01"
          ? [
              `Connected to ${target}, but the schema is missing (no bot_jobs table).`,
              "Apply the migrations with `pnpm db:migrate`.",
            ]
          : code === "28P01" || code === "28000" || code === "3D000"
            ? [
                `Postgres at ${target} refused the login or database in DATABASE_URL.`,
                "Check the user, password and database name.",
              ]
            : code === "42501"
              ? [
                  `Connected to ${target}, but this role lacks permission on bot_jobs.`,
                  "DATABASE_URL must use the scrimbot_bot role, and migrations must have run.",
                ]
              : [`Could not use the database at ${target}.`, "See the error below."];
    log.fatal(
      { err: error, database: target },
      `${reason} ${fix} The bot cannot start without it.`,
    );
    process.exit(1);
  }
}
