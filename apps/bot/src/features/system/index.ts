import { defineJob, defineListener } from "../../framework/types.js";
import type { Feature } from "../../framework/types.js";

/** Housekeeping: records startup and handles the job that proves the web-to-bot queue works. */
export const systemFeature: Feature = {
  name: "system",
  events: [
    defineListener({
      event: "clientReady",
      async execute({ log }, client) {
        log.info(
          { user: client.user.tag, guilds: client.guilds.cache.size },
          "Connected to Discord",
        );
      },
    }),
  ],
  jobs: [
    defineJob({
      type: "system.heartbeat",
      async execute(payload, { log }) {
        log.info({ note: payload.note }, "Heartbeat job received");
      },
    }),
  ],
};
