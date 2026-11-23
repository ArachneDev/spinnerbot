import { type JobType, isJobType } from "@scrimbot/core";
import { GatewayIntentBits } from "discord.js";
import type {
  ComponentHandler,
  EventListener,
  Feature,
  JobHandler,
  SlashCommand,
} from "./types.js";

const FEATURE_NAME = /^[a-z][a-z-]*$/;
const ACTION_NAME = /^[a-zA-Z0-9-]+$/;

export interface Registered<T> {
  feature: string;
  handler: T;
}

export interface Registry {
  commands: Map<string, Registered<SlashCommand>>;
  components: Map<string, Registered<ComponentHandler>>;
  jobs: Map<JobType, Registered<JobHandler>>;
  events: Registered<EventListener>[];
  intents: GatewayIntentBits[];
}

/** Combines the features, and fails at startup if any two of them collide. */
export function buildRegistry(features: Feature[]): Registry {
  const registry: Registry = {
    commands: new Map(),
    components: new Map(),
    jobs: new Map(),
    events: [],
    intents: [],
  };
  const names = new Set<string>();
  const intents = new Set<GatewayIntentBits>([GatewayIntentBits.Guilds]);

  for (const feature of features) {
    if (!FEATURE_NAME.test(feature.name)) {
      throw new Error(`Feature name "${feature.name}" must match ${FEATURE_NAME}`);
    }
    if (names.has(feature.name)) throw new Error(`Duplicate feature "${feature.name}"`);
    names.add(feature.name);

    feature.intents?.forEach((intent) => intents.add(intent));

    for (const handler of feature.commands ?? []) {
      const name = handler.data.name;
      const existing = registry.commands.get(name);
      if (existing) {
        throw new Error(`Command /${name} is in both ${existing.feature} and ${feature.name}`);
      }
      registry.commands.set(name, { feature: feature.name, handler });
    }

    for (const handler of feature.components ?? []) {
      if (!ACTION_NAME.test(handler.action)) {
        throw new Error(`Action "${handler.action}" in ${feature.name} must match ${ACTION_NAME}`);
      }
      const key = `${feature.name}:${handler.action}`;
      if (registry.components.has(key)) throw new Error(`Duplicate component "${key}"`);
      registry.components.set(key, { feature: feature.name, handler });
    }

    for (const handler of feature.jobs ?? []) {
      if (!isJobType(handler.type)) throw new Error(`Unknown job type "${String(handler.type)}"`);
      const existing = registry.jobs.get(handler.type);
      if (existing) {
        throw new Error(
          `Job ${handler.type} is handled by both ${existing.feature} and ${feature.name}`,
        );
      }
      registry.jobs.set(handler.type, { feature: feature.name, handler });
    }

    for (const handler of feature.events ?? []) {
      registry.events.push({ feature: feature.name, handler });
    }
  }

  registry.intents = [...intents];
  return registry;
}

/** Builds a customId the router sends back to this feature's handler. */
export function customId(feature: string, action: string, ...args: string[]): string {
  const id = [feature, action, ...args].join(":");
  if (id.length > 100) throw new Error(`customId "${id}" is over Discord's 100 character limit`);
  return id;
}
