import type { DatabaseHandle } from "@scrimbot/db";
import type { Hono } from "hono";
import type { Logger } from "pino";

export interface ServerContext {
  database: DatabaseHandle;
  log: Logger;
}

/** One feature's API. Its routes are mounted under /api/<name>. */
export interface WebFeature {
  name: string;
  routes(context: ServerContext): Hono;
}
