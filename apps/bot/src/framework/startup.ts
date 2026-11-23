import type { DatabaseHandle } from "@scrimbot/db";

/** Host, port and database of a connection URL, without the credentials. */
function describeTarget(url: string): string {
  try {
    const { hostname, port, pathname } = new URL(url);
    return `${hostname}:${port || "5432"}${pathname}`;
  } catch {
    return "(the database URL is not valid)";
  }
}

/**
 * Throws, with a reason and a fix, when the database can't be used. The bot needs it for the job
 * queue that carries requests from the web app, so the caller retries until it works.
 */
export async function assertDatabaseReady(
  database: DatabaseHandle,
  databaseUrl: string,
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
                `Postgres at ${target} refused the login or database.`,
                "Check the user, password and database name.",
              ]
            : code === "42501"
              ? [
                  `Connected to ${target}, but this role lacks permission on bot_jobs.`,
                  "The URL must use the scrimbot_bot role, and migrations must have run.",
                ]
              : [`Could not use the database at ${target}.`, "See the error below."];
    throw new Error(`${reason} ${fix}`, { cause: error });
  }
}
