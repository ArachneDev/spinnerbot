import type { Client } from "discord.js";
import type { Registry } from "./registry.js";
import type { FeatureContext } from "./types.js";

/** Attaches every feature's listeners. A failing listener is logged and doesn't affect others. */
export function attachListeners(client: Client, registry: Registry, context: FeatureContext): void {
  for (const { feature, handler } of registry.events) {
    const log = context.log.child({ feature, event: handler.event });
    client.on(handler.event, (...args) => {
      void handler.execute({ ...context, log }, ...args).catch((error: unknown) => {
        log.error({ err: error }, "Listener failed");
      });
    });
  }
}
