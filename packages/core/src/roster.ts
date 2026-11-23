import { z } from "zod";
import type { EventSnapshot } from "./events.js";

/** How many squads a new roster starts with. */
export const SQUAD_COUNT = 7;
/** Discord allows 25 fields and 6000 characters in an embed, so this leaves room for players. */
export const MAX_SQUADS = 12;

/** The clan's squads, in the order of the board's slots. Each slot keeps its colour when renamed. */
export const SYSTEM_SQUADS = [
  { name: "CERBERUS", type: "Assault" },
  { name: "BLACKSPEAR", type: "Assault" },
  { name: "DIREHOUND", type: "Assault" },
  { name: "DEADWATCH", type: "Recon" },
  { name: "FORGEWEAVER", type: "Builders" },
  { name: "DREADNOUGHT", type: "Mech Assault" },
  { name: "DEATHWING", type: "Air Assault" },
] as const;

export const DEFAULT_SQUAD_NAMES: string[] = SYSTEM_SQUADS.map((squad) => squad.name);

export const squadNameSchema = z.string().trim().min(1).max(32);
export const squadNamesSchema = z.array(squadNameSchema).min(1).max(MAX_SQUADS);

/** A squad's type, only while it still carries one of the clan's own names. */
export function squadType(name: string): string | undefined {
  return SYSTEM_SQUADS.find((squad) => squad.name === name.trim().toUpperCase())?.type;
}

const participantSchema = z.object({
  displayName: z.string(),
  discordUserId: z.string().optional(),
});

export type StoredParticipant = z.infer<typeof participantSchema>;

/** An EventSnapshot as stored in JSON, where dates are text. */
export const storedEventSchema = z.object({
  title: z.string(),
  startsAt: z.string().optional(),
  responses: z.object({
    accepted: z.array(participantSchema),
    declined: z.array(participantSchema),
    tentative: z.array(participantSchema),
  }),
  complete: z.boolean(),
});
export type StoredEvent = z.infer<typeof storedEventSchema>;

export function toStoredEvent(event: EventSnapshot): StoredEvent {
  return {
    title: event.title,
    ...(event.startsAt ? { startsAt: event.startsAt.toISOString() } : {}),
    responses: event.responses,
    complete: event.complete,
  };
}

/** Accepted-player index (as a string) to squad number. Anyone not listed is on the bench. */
export const assignmentsSchema = z.record(z.string(), z.number().int().min(1).max(MAX_SQUADS));
export type Assignments = z.infer<typeof assignmentsSchema>;

/** Drops entries that don't point at one of the accepted players, or at a squad that exists. */
export function cleanAssignments(
  assignments: Assignments,
  acceptedCount: number,
  squadCount = MAX_SQUADS,
): Assignments {
  return Object.fromEntries(
    Object.entries(assignments).filter(([key, squad]) => {
      const index = Number(key);
      return Number.isInteger(index) && index >= 0 && index < acceptedCount && squad <= squadCount;
    }),
  );
}

/** Squad number (as a string) to the accepted-player index of its squad leader. */
export const squadLeadersSchema = z.record(z.string(), z.number().int().min(0));
export type SquadLeaders = z.infer<typeof squadLeadersSchema>;

/** Drops leaders who aren't, or are no longer, assigned to the squad they lead. */
export function cleanSquadLeaders(leaders: SquadLeaders, assignments: Assignments): SquadLeaders {
  return Object.fromEntries(
    Object.entries(leaders).filter(
      ([squad, index]) => assignments[String(index)] === Number(squad),
    ),
  );
}

export interface RosterSquad {
  number: number;
  name: string;
  type?: string;
  /** Listed first in `players` as well. */
  leader?: StoredParticipant;
  players: StoredParticipant[];
}

export interface RosterView {
  squads: RosterSquad[];
  bench: StoredParticipant[];
}

export function buildRoster(
  event: StoredEvent,
  assignments: Assignments,
  {
    squadNames = DEFAULT_SQUAD_NAMES,
    squadLeaders = {},
  }: { squadNames?: string[]; squadLeaders?: SquadLeaders } = {},
): RosterView {
  const squads: RosterSquad[] = squadNames.map((name, i) => {
    const type = squadType(name);
    return { number: i + 1, name, ...(type ? { type } : {}), players: [] };
  });
  const bench: StoredParticipant[] = [];
  event.responses.accepted.forEach((player, index) => {
    const squad = assignments[String(index)];
    // A squad that has since been removed counts as the bench.
    (squad ? (squads[squad - 1]?.players ?? bench) : bench).push(player);
  });
  for (const squad of squads) {
    const index = squadLeaders[String(squad.number)];
    const leader = index === undefined ? undefined : event.responses.accepted[index];
    if (!leader || assignments[String(index)] !== squad.number) continue;
    squad.leader = leader;
    squad.players = [leader, ...squad.players.filter((player) => player !== leader)];
  }
  return { squads, bench };
}

/** Everyone placed in a squad. These are the people who are asked to confirm. */
export function listedPlayers(roster: RosterView): StoredParticipant[] {
  return roster.squads.flatMap((squad) => squad.players);
}

/** Discord allows five buttons in a row. Answers get one row, and Edit and Delete the next. */
export const MAX_ANSWERS = 5;
/** The first answer is always this one, and it is the one the Confirmed counter counts. */
export const CONFIRM_KEY = "confirmed";

const UNICODE_EMOJI =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;

/** A standard emoji has only a name (the character). A server emoji also has an id. */
export const answerEmojiSchema = z.union([
  z.object({ name: z.string().max(32).regex(UNICODE_EMOJI) }).strict(),
  z
    .object({
      id: z.string().regex(/^\d{15,25}$/),
      name: z.string().regex(/^\w{2,32}$/),
      animated: z.boolean().optional(),
    })
    .strict(),
]);
export type AnswerEmoji = z.infer<typeof answerEmojiSchema>;

export const answerOptionSchema = z.object({
  /** Stable, so answers already given survive a rename. Only the first is fixed. */
  key: z.string().regex(/^[a-z0-9]{1,12}$/),
  label: z.string().trim().min(1).max(80),
  emoji: answerEmojiSchema.optional(),
});
export type AnswerOption = z.infer<typeof answerOptionSchema>;

export const answerOptionsSchema = z
  .array(answerOptionSchema)
  .min(1)
  .max(MAX_ANSWERS)
  .refine((options) => options[0]?.key === CONFIRM_KEY, "The first answer must be the Confirm one")
  .refine((options) => new Set(options.map((o) => o.key)).size === options.length, "Duplicate key");

export const DEFAULT_ANSWER_OPTIONS: AnswerOption[] = [
  { key: CONFIRM_KEY, label: "Confirm", emoji: { name: "✅" } },
  { key: "denied", label: "Can’t make it", emoji: { name: "❌" } },
];

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((url) => url.startsWith("https://"), "Must be https");
const styleText = (max: number) => z.string().trim().min(1).max(max).optional();

/** How the leader dressed the roster embed. Anything left out uses the Arachne default. */
export const embedStyleSchema = z.object({
  /** The line above the title. */
  heading: styleText(100),
  /** Replaces the event's title. */
  title: styleText(200),
  description: styleText(1000),
  footer: styleText(200),
  /** The sidebar, as #rrggbb. Left out, it is red until everyone is placed, then green. */
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** Shows the squads as a picture for the banner, instead of the Arachne art. */
  bannerImage: z.literal("roster").optional(),
  /** The roster image's big title, and its optional facts. */
  imageTitle: styleText(40),
  opponents: styleText(40),
  map: styleText(40),
  faction: styleText(40),
  /** A picture to show instead of the Arachne banner. */
  bannerUrl: httpsUrl.optional(),
  /** The small picture at the top right. */
  thumbnail: z.union([z.literal("crest"), httpsUrl]).optional(),
  /** Whether squads sit side by side or one per row. */
  layout: z.enum(["columns", "stacked"]).optional(),
  showTime: z.boolean().optional(),
  showProgress: z.boolean().optional(),
  benchName: styleText(32),
  pendingEmoji: answerEmojiSchema.optional(),
  leaderEmoji: answerEmojiSchema.optional(),
  /** One per squad, in board order. */
  squadEmojis: z.array(answerEmojiSchema.nullable()).max(MAX_SQUADS).optional(),
});
export type EmbedStyle = z.infer<typeof embedStyleSchema>;

/** An emoji as it is written inside message text. */
export function formatEmoji(emoji: AnswerEmoji): string {
  return "id" in emoji ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : emoji.name;
}

/** The server emoji the bot found, saved so the web page can offer them without asking Discord. */
export const emojiCacheSchema = z.object({
  loadedAt: z.string(),
  emojis: z.array(z.object({ id: z.string(), name: z.string(), animated: z.boolean().optional() })),
});
export type EmojiCache = z.infer<typeof emojiCacheSchema>;

/** True when every server emoji in the options is one the bot listed for this server. */
export function usesOnlyKnownEmoji(options: AnswerOption[], cache: EmojiCache | null): boolean {
  const known = new Set(cache?.emojis.map((e) => e.id));
  return options.every((o) => !o.emoji || !("id" in o.emoji) || known.has(o.emoji.id));
}

/** The same check for a style, which also holds emoji. */
export function styleUsesOnlyKnownEmoji(style: EmbedStyle, cache: EmojiCache | null): boolean {
  const known = new Set(cache?.emojis.map((e) => e.id));
  const emojis: (AnswerEmoji | null | undefined)[] = [
    style.pendingEmoji,
    style.leaderEmoji,
    ...(style.squadEmojis ?? []),
  ];
  return emojis.every((emoji) => !emoji || !("id" in emoji) || known.has(emoji.id));
}
