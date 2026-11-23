import { warnMissingAssets } from "./framework/assets.js";
import { loadBrand } from "./framework/brand.js";
import { createDatabase } from "@scrimbot/db";
import { Client, Events } from "discord.js";
import { features } from "./features/index.js";
import { loadConfig } from "./framework/config.js";
import { attachListeners } from "./framework/events.js";
import { writeHeartbeat } from "./framework/heartbeat.js";
import { createJobWorker } from "./framework/job-worker.js";
import { createLogger } from "./framework/logger.js";
import { createPythonBridge } from "./framework/python.js";
import { buildRegistry } from "./framework/registry.js";
import { routeInteraction } from "./framework/router.js";
import { assertDatabaseReady } from "./framework/startup.js";
import type { FeatureContext } from "./framework/types.js";

const config = loadConfig();
const log = createLogger(config.logLevel);

// A stray rejection in one feature is logged and doesn't stop the others.
process.on("unhandledRejection", (reason) => log.error({ err: reason }, "Unhandled rejection"));

warnMissingAssets(log);
const registry = buildRegistry(features);
const database = createDatabase(config.databaseUrl);
const client = new Client({
  intents: registry.intents,
});
const python = createPythonBridge({ log, pythonBin: config.pythonBin });
const context: FeatureContext = {
  client,
  database,
  log,
  python,
  publicUrl: config.publicUrl,
};
const worker = createJobWorker(registry, context);

attachListeners(client, registry, context);
client.on(Events.InteractionCreate, (interaction) => {
  void routeInteraction(interaction, registry, context).catch((error: unknown) => {
    log.error({ err: error }, "Interaction routing failed");
  });
});

const heartbeat = setInterval(() => {
  if (client.isReady()) writeHeartbeat();
}, 30_000);
client.once(Events.ClientReady, (ready) => {
  writeHeartbeat();
  // Embeds work without these, so a failure here is not worth stopping for.
  void loadBrand(ready).catch((error: unknown) => {
    log.warn({ err: error }, "Could not load the bot's icon and squad leader emblem");
  });
  // Job handlers use the Discord connection, so jobs wait for it rather than fail and retry.
  void worker.start().catch((error: unknown) => {
    log.fatal(
      { err: error },
      "Job worker failed to start: could not listen on the database job queue",
    );
    process.exit(1);
  });
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "Shutting down");
  clearInterval(heartbeat);
  await worker.stop();
  await client.destroy();
  await database.sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await assertDatabaseReady(database, config.databaseUrl, log);
await client.login(config.discordToken).catch((error: unknown) => {
  log.fatal(
    { err: error },
    "Discord login failed. Check DISCORD_TOKEN, and that the privileged intents the bot needs are enabled in the Developer Portal.",
  );
  process.exit(1);
});
