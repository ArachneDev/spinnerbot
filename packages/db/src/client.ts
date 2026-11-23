import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDatabase(url: string, options: { max?: number } = {}) {
  const sqlClient = postgres(url, { max: options.max ?? 5, onnotice: () => {} });
  return { db: drizzle(sqlClient, { schema }), sql: sqlClient };
}

export type DatabaseHandle = ReturnType<typeof createDatabase>;
export type Database = DatabaseHandle["db"];
/** A database or an open transaction, so callers can enqueue alongside their own writes. */
export type Executor = Pick<Database, "execute" | "insert">;
