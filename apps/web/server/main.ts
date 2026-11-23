import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createDatabase } from "@scrimbot/db";
import { pino } from "pino";
import { createApp } from "./app.js";
import { assetsDir, warnMissingBrand } from "./brand.js";
import { loadConfig } from "./config.js";
import { webFeatures } from "./features/index.js";

const config = loadConfig();
const log = pino({ level: config.logLevel, base: { app: "web" } });

process.on("unhandledRejection", (reason) => log.error({ err: reason }, "Unhandled rejection"));

const database = createDatabase(config.databaseUrl);
// serveStatic takes a path relative to the working directory.
const clientRoot = relative(process.cwd(), fileURLToPath(new URL("../client", import.meta.url)));
const art = assetsDir();
warnMissingBrand(art, log);
const app = createApp({ database, log }, { features: webFeatures, clientRoot, assetsDir: art });

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  log.info({ port }, "Web server listening");
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "Shutting down");
  server.close(() => {
    void database.sql.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
