import {
  type ChannelType,
  type ChatInputCommandInteraction,
  type CommandInteractionOption,
  InteractionContextType,
  type PermissionResolvable,
  SlashCommandBuilder,
} from "discord.js";
import { STAFF_VISIBILITY } from "../command-access.js";
import { isPublicCommand } from "./access.js";
import type { FeatureContext, SlashCommand } from "./types.js";

interface BaseOption {
  description: string;
  /** Discord won't let the user send the command without this input. */
  required?: boolean;
}

interface Choice<V> {
  /** The label the user sees. */
  name: string;
  value: V;
}

export interface StringOption extends BaseOption {
  type: "string";
  /** Limits the input to a fixed list, up to 25. */
  choices?: readonly Choice<string>[];
  minLength?: number;
  maxLength?: number;
}

export interface IntegerOption extends BaseOption {
  type: "integer";
  choices?: readonly Choice<number>[];
  min?: number;
  max?: number;
}

export interface NumberOption extends BaseOption {
  type: "number";
  choices?: readonly Choice<number>[];
  min?: number;
  max?: number;
}

export interface BooleanOption extends BaseOption {
  type: "boolean";
}

export interface UserOption extends BaseOption {
  type: "user";
}

export interface ChannelOption extends BaseOption {
  type: "channel";
  /** Limits the picker, such as to text channels. */
  channelTypes?: readonly ChannelType[];
}

export interface RoleOption extends BaseOption {
  type: "role";
}

/** A user or a role. */
export interface MentionableOption extends BaseOption {
  type: "mentionable";
}

/** An uploaded file. */
export interface AttachmentOption extends BaseOption {
  type: "attachment";
}

export type OptionSpec =
  | StringOption
  | IntegerOption
  | NumberOption
  | BooleanOption
  | UserOption
  | ChannelOption
  | RoleOption
  | MentionableOption
  | AttachmentOption;

export type OptionSpecs = Readonly<Record<string, OptionSpec>>;

// What handlers receive. These are plain JSON, so Python gets exactly the same shape.

export interface UserInput {
  id: string;
  username: string;
  /** Their name in this server. */
  displayName: string;
  isBot: boolean;
}

export interface ChannelInput {
  id: string;
  name: string | null;
  type: number;
}

export interface RoleInput {
  id: string;
  name: string;
}

export type MentionableInput = (UserInput & { kind: "user" }) | (RoleInput & { kind: "role" });

export interface AttachmentInput {
  name: string;
  url: string;
  contentType: string | null;
  /** In bytes. */
  size: number;
}

type ValueOf<S extends OptionSpec> = S extends { choices: readonly Choice<infer V>[] }
  ? V
  : S extends StringOption
    ? string
    : S extends IntegerOption | NumberOption
      ? number
      : S extends BooleanOption
        ? boolean
        : S extends UserOption
          ? UserInput
          : S extends ChannelOption
            ? ChannelInput
            : S extends RoleOption
              ? RoleInput
              : S extends MentionableOption
                ? MentionableInput
                : AttachmentInput;

type Flatten<T> = { [K in keyof T]: T[K] };

/** Required inputs are always present. Optional ones are missing when the user leaves them out. */
export type InputOf<O extends OptionSpecs> = Flatten<
  { -readonly [K in keyof O as O[K] extends { required: true } ? K : never]: ValueOf<O[K]> } & {
    -readonly [K in keyof O as O[K] extends { required: true } ? never : K]?: ValueOf<O[K]>;
  }
>;

export interface CommandDefinition<O extends OptionSpecs> {
  name: string;
  description: string;
  options?: O;
  /**
   * How to acknowledge before `execute` runs, by default "ephemeral", which only the user sees.
   * Discord allows 3 seconds otherwise, so answer deferred commands with `editReply`.
   * Use "none" only when `execute` replies immediately with `reply`.
   */
  defer?: SlashCommand["defer"];
  /** Allow use in DMs with the bot. By default commands work only in servers. */
  allowInDms?: boolean;
  /** Who sees the command by default. Admins can change this under Server Settings, Integrations. */
  defaultMemberPermissions?: bigint;
  /** Checked on every use, whatever Integrations says. */
  requiredPermissions?: PermissionResolvable;
  execute(
    interaction: ChatInputCommandInteraction,
    input: InputOf<O>,
    context: FeatureContext,
  ): Promise<void>;
}

function buildData(definition: CommandDefinition<OptionSpecs>): SlashCommandBuilder {
  const builder = new SlashCommandBuilder()
    .setName(definition.name)
    .setDescription(definition.description);

  if (!definition.allowInDms) builder.setContexts(InteractionContextType.Guild);
  const visibleTo =
    definition.defaultMemberPermissions ??
    (isPublicCommand(definition.name) ? undefined : STAFF_VISIBILITY);
  if (visibleTo !== undefined) builder.setDefaultMemberPermissions(visibleTo);

  // Discord rejects a command that lists an optional input before a required one.
  const entries = Object.entries(definition.options ?? {}).sort(
    ([, a], [, b]) => Number(b.required ?? false) - Number(a.required ?? false),
  );

  for (const [name, spec] of entries) {
    const base = <T extends { setName(n: string): T; setDescription(d: string): T }>(option: T) =>
      option.setName(name).setDescription(spec.description);
    const required = spec.required ?? false;

    switch (spec.type) {
      case "string":
        builder.addStringOption((option) => {
          base(option).setRequired(required);
          if (spec.choices) option.setChoices(...spec.choices);
          if (spec.minLength !== undefined) option.setMinLength(spec.minLength);
          if (spec.maxLength !== undefined) option.setMaxLength(spec.maxLength);
          return option;
        });
        break;
      case "integer":
        builder.addIntegerOption((option) => {
          base(option).setRequired(required);
          if (spec.choices) option.setChoices(...spec.choices);
          if (spec.min !== undefined) option.setMinValue(spec.min);
          if (spec.max !== undefined) option.setMaxValue(spec.max);
          return option;
        });
        break;
      case "number":
        builder.addNumberOption((option) => {
          base(option).setRequired(required);
          if (spec.choices) option.setChoices(...spec.choices);
          if (spec.min !== undefined) option.setMinValue(spec.min);
          if (spec.max !== undefined) option.setMaxValue(spec.max);
          return option;
        });
        break;
      case "boolean":
        builder.addBooleanOption((option) => base(option).setRequired(required));
        break;
      case "user":
        builder.addUserOption((option) => base(option).setRequired(required));
        break;
      case "channel":
        builder.addChannelOption((option) => {
          base(option).setRequired(required);
          if (spec.channelTypes) {
            option.addChannelTypes(
              ...(spec.channelTypes as Parameters<typeof option.addChannelTypes>),
            );
          }
          return option;
        });
        break;
      case "role":
        builder.addRoleOption((option) => base(option).setRequired(required));
        break;
      case "mentionable":
        builder.addMentionableOption((option) => base(option).setRequired(required));
        break;
      case "attachment":
        builder.addAttachmentOption((option) => base(option).setRequired(required));
        break;
    }
  }
  return builder;
}

function toUserInput(raw: CommandInteractionOption): UserInput {
  const user = raw.user!;
  const member = raw.member;
  return {
    id: user.id,
    username: user.username,
    displayName: member && "displayName" in member ? member.displayName : user.displayName,
    isBot: user.bot,
  };
}

function toRoleInput(raw: CommandInteractionOption): RoleInput {
  return { id: raw.role!.id, name: raw.role!.name };
}

function readValue(spec: OptionSpec, raw: CommandInteractionOption): unknown {
  switch (spec.type) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
      return raw.value;
    case "user":
      return toUserInput(raw);
    case "channel":
      return { id: raw.channel!.id, name: raw.channel!.name, type: raw.channel!.type };
    case "role":
      return toRoleInput(raw);
    case "mentionable":
      return raw.user
        ? { kind: "user", ...toUserInput(raw) }
        : { kind: "role", ...toRoleInput(raw) };
    case "attachment": {
      const file = raw.attachment!;
      return {
        name: file.name,
        url: file.url,
        contentType: file.contentType,
        size: file.size,
      };
    }
  }
}

/** Reads the interaction's inputs. Optional inputs the user left out are absent from the result. */
export function readInput<O extends OptionSpecs>(
  interaction: Pick<ChatInputCommandInteraction, "options">,
  specs: O,
): InputOf<O> {
  const input: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs)) {
    // Throws if a required input is missing, which only a stale command registration can cause.
    const raw = interaction.options.get(name, spec.required ?? false);
    if (raw) input[name] = readValue(spec, raw);
  }
  return input as InputOf<O>;
}

/**
 * Defines a slash command from a list of inputs. The handler's `input` is typed from that list.
 *
 * ```ts
 * defineCommand({
 *   name: "kick-vote",
 *   description: "Start a vote",
 *   options: {
 *     player: { type: "user", description: "Who", required: true },
 *     reason: { type: "string", description: "Why", maxLength: 200 },
 *   },
 *   async execute(interaction, input) {
 *     await interaction.editReply(`${input.player.displayName}: ${input.reason ?? "no reason"}`);
 *   },
 * });
 * ```
 */
export function defineCommand<const O extends OptionSpecs = Record<never, never>>(
  definition: CommandDefinition<O>,
): SlashCommand {
  const specs: OptionSpecs = definition.options ?? {};
  return {
    data: buildData(definition as unknown as CommandDefinition<OptionSpecs>),
    defer: definition.defer ?? "ephemeral",
    ...(definition.requiredPermissions !== undefined && {
      requiredPermissions: definition.requiredPermissions,
    }),
    execute: (interaction, context) =>
      definition.execute(interaction, readInput(interaction, specs) as InputOf<O>, context),
  };
}
