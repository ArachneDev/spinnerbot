import type { JobPayload, JobType } from "@scrimbot/core";
import type { DatabaseHandle } from "@scrimbot/db";
import type {
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  GatewayIntentBits,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  PermissionResolvable,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import type { Logger } from "./logger.js";
import type { PythonBridge } from "./python.js";

/** What every handler receives. Features get their dependencies here, never from each other. */
export interface FeatureContext {
  client: Client;
  database: DatabaseHandle;
  log: Logger;
  python: PythonBridge;
  /** Where the web app lives, without a trailing slash. Used to build links for users. */
  publicUrl: string;
}

export interface SlashCommand {
  /** Anything with toJSON. Usually written with defineCommand, which builds this for you. */
  data: { name: string; toJSON(): RESTPostAPIApplicationCommandsJSONBody };
  /**
   * How to acknowledge before `execute` runs. Discord allows 3 seconds, so use "ephemeral" or
   * "public" for anything that might take longer, then reply with `editReply`. Use "none" only
   * when `execute` replies immediately or opens a modal.
   */
  defer: "ephemeral" | "public" | "none";
  /** Checked on every use. Leave unset when Server Settings, Integrations should decide alone. */
  requiredPermissions?: PermissionResolvable;
  execute(interaction: ChatInputCommandInteraction, context: FeatureContext): Promise<void>;
}

/** A button, select menu or modal. Its customId is `<feature>:<action>[:<arg>...]`. */
export interface ComponentHandler {
  action: string;
  execute(
    interaction: MessageComponentInteraction | ModalSubmitInteraction,
    args: string[],
    context: FeatureContext,
  ): Promise<void>;
}

export interface EventListener<E extends keyof ClientEvents = keyof ClientEvents> {
  event: E;
  execute(context: FeatureContext, ...args: ClientEvents[E]): Promise<void>;
}

export interface JobHandler<T extends JobType = JobType> {
  type: T;
  /** Can run more than once for the same job, so it must be safe to repeat. */
  execute(payload: JobPayload<T>, context: FeatureContext): Promise<void>;
}

export interface Feature {
  /** Lowercase letters and hyphens. Also the customId prefix. */
  name: string;
  /** Gateway intents this feature needs. The client requests only the union of these. */
  intents?: GatewayIntentBits[];
  commands?: SlashCommand[];
  components?: ComponentHandler[];
  // Listeners differ by event, and defineListener keeps each one correctly typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events?: EventListener<any>[];
  // Handlers differ by job type, and defineJob keeps each one correctly typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jobs?: JobHandler<any>[];
}

export function defineListener<E extends keyof ClientEvents>(
  listener: EventListener<E>,
): EventListener<E> {
  return listener;
}

export function defineJob<T extends JobType>(handler: JobHandler<T>): JobHandler<T> {
  return handler;
}
