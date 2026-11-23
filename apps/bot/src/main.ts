import { warnMissingAssets } from "./framework/assets.js";
import { loadBrand } from "./framework/brand.js";
import { createDatabase, prepareDatabase } from "@scrimbot/db";
import { Client, Events } from "discord.js";
import { features } from "./features/index.js";
import { loadConfig } from "./framework/config.js";
import { attachListeners } from "./framework/events.js";
import { writeHeartbeat } from "./framework/heartbeat.js";
import { createJobWorker } from "./framework/job-worker.js";
import { createLogger } from "./framework/logger.js";
import { createPythonBridge } from "./framework/python.js";
import { buildRegistry } from "./framework/registry.js";
import { registerCommands } from "./framework/register-commands.js";
import { retryWithBackoff } from "./framework/retry.js";
import { routeInteraction } from "./framework/router.js";
import { assertDatabaseReady } from "./framework/startup.js";
import type { FeatureContext } from "./framework/types.js";

const config = loadConfig();
const log = createLogger(config.logLevel);

// The health check reads this, so start it before anything that can fail or wait. A broken
// database or login is retried below and logged, and the container stays up meanwhile.
writeHeartbeat();
const heartbeat = setInterval(writeHeartbeat, 30_000);

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

client.once(Events.ClientReady, (ready) => {
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

// Without a database or a login the bot can't work, but it keeps trying instead of exiting, so a
// restart isn't needed once the problem is fixed.
await retryWithBackoff(
  "Database setup",
  async () => {
    const { ownerDatabaseUrl, webDatabaseUrl } = config;
    // In production the bot migrates and sets both roles' passwords; in dev `pnpm dev` does.
    if (ownerDatabaseUrl && webDatabaseUrl) {
      await prepareDatabase({
        owner: ownerDatabaseUrl,
        web: webDatabaseUrl,
        bot: config.databaseUrl,
      });
    }
    await assertDatabaseReady(database, config.databaseUrl);
  },
  log,
);
await retryWithBackoff(
  "Discord login",
  () =>
    client.login(config.discordToken).catch(async (error: unknown) => {
      await client.destroy(); // so the next attempt starts from a clean client
      throw new Error(
        "Discord login failed. Check DISCORD_TOKEN, and that the privileged intents the bot needs are enabled in the Developer Portal.",
        { cause: error },
      );
    }),
  log,
);
await retryWithBackoff(
  "Registering slash commands",
  async () => {
    for (const line of await registerCommands(
      client.rest,
      registry,
      config.applicationId,
      config.devGuildId,
    )) {
      log.info(line);
    }
  },
  log,
);
