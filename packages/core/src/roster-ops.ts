import { z } from "zod";
import {
  answerEmojiSchema,
  answerOptionsSchema,
  embedStyleSchema,
  MAX_SQUADS,
  squadNameSchema,
  type AnswerEmoji,
  type AnswerOption,
  type Assignments,
  type EmbedStyle,
  type SquadLeaders,
} from "./roster.js";

/**
 * Everything on a roster's web page that people change. The server keeps the true copy and
 * applies changes to it one at a time, and each browser runs the same function to show its own
 * changes at once. Both sides running identical code is what keeps every copy the same.
 */
export interface BoardState {
  assignments: Assignments;
  squadLeaders: SquadLeaders;
  squadNames: string[];
  showBanner: boolean;
  showBench: boolean;
  embedStyle: EmbedStyle;
  answerOptions: AnswerOption[];
}

/** The style fields set one at a time. Squad emoji have their own change, per squad. */
const STYLE_FIELDS = [
  "heading",
  "title",
  "description",
  "footer",
  "colour",
  "bannerImage",
  "imageTitle",
  "opponents",
  "map",
  "faction",
  "bannerUrl",
  "thumbnail",
  "layout",
  "showTime",
  "showProgress",
  "benchName",
  "pendingEmoji",
  "leaderEmoji",
] as const satisfies readonly (keyof EmbedStyle)[];
export type StyleField = (typeof STYLE_FIELDS)[number];

const player = z.number().int().min(0).max(1000);
const squad = z.number().int().min(1).max(MAX_SQUADS);

export const rosterOpSchema = z.discriminatedUnion("type", [
  /** Squad 0 is the bench. */
  z.object({ type: z.literal("move"), player, squad: z.number().int().min(0).max(MAX_SQUADS) }),
  /** Makes the player their current squad's leader, or stops them leading it. */
  z.object({ type: z.literal("leader"), player, lead: z.boolean() }),
  z.object({ type: z.literal("rename"), squad, name: squadNameSchema }),
  z.object({ type: z.literal("addSquad"), name: squadNameSchema }),
  z.object({ type: z.literal("removeSquad"), squad }),
  z.object({ type: z.literal("squadEmoji"), squad, emoji: answerEmojiSchema.nullable() }),
  /** Null clears the field back to the Arachne default. */
  z.object({ type: z.literal("style"), field: z.enum(STYLE_FIELDS), value: z.unknown() }),
  z.object({
    type: z.literal("toggle"),
    field: z.enum(["showBanner", "showBench"]),
    value: z.boolean(),
  }),
  z.object({ type: z.literal("answers"), options: answerOptionsSchema }),
]);
export type RosterOp = z.infer<typeof rosterOpSchema>;

/** A change that can never be valid, such as a style value of the wrong kind. */
export class InvalidOpError extends Error {}

const squadOf = (state: BoardState, index: number) => state.assignments[String(index)] ?? 0;

function removeSquadFrom(state: BoardState, number: number): BoardState {
  const renumber = (n: number) => (n > number ? n - 1 : n);
  const { squadEmojis } = state.embedStyle;
  return {
    ...state,
    assignments: Object.fromEntries(
      Object.entries(state.assignments)
        .filter(([, assigned]) => assigned !== number)
        .map(([index, assigned]) => [index, renumber(assigned)]),
    ),
    squadLeaders: Object.fromEntries(
      Object.entries(state.squadLeaders)
        .filter(([n]) => Number(n) !== number)
        .map(([n, index]) => [String(renumber(Number(n))), index]),
    ),
    squadNames: state.squadNames.filter((_, i) => i !== number - 1),
    embedStyle: squadEmojis
      ? { ...state.embedStyle, squadEmojis: squadEmojis.filter((_, i) => i !== number - 1) }
      : state.embedStyle,
  };
}

/**
 * Applies one change. A change that points at something someone else has since removed, like a
 * squad or a player, does nothing, because whoever changed it last wins. `players` is how many
 * accepted players the roster has.
 */
export function applyOp(state: BoardState, op: RosterOp, players: number): BoardState {
  const squads = state.squadNames.length;
  switch (op.type) {
    case "move": {
      if (op.player >= players || op.squad > squads) return state;
      const from = squadOf(state, op.player);
      if (from === op.squad) return state;
      const assignments = { ...state.assignments };
      if (op.squad === 0) delete assignments[String(op.player)];
      else assignments[String(op.player)] = op.squad;
      const squadLeaders = { ...state.squadLeaders };
      // A leader who leaves stops leading.
      if (squadLeaders[String(from)] === op.player) delete squadLeaders[String(from)];
      return { ...state, assignments, squadLeaders };
    }
    case "leader": {
      const number = squadOf(state, op.player);
      if (op.player >= players || number === 0) return state;
      const squadLeaders = { ...state.squadLeaders };
      if (op.lead) squadLeaders[String(number)] = op.player;
      else if (squadLeaders[String(number)] === op.player) delete squadLeaders[String(number)];
      else return state;
      return { ...state, squadLeaders };
    }
    case "rename":
      if (op.squad > squads) return state;
      return {
        ...state,
        squadNames: state.squadNames.map((name, i) => (i === op.squad - 1 ? op.name : name)),
      };
    case "addSquad":
      if (squads >= MAX_SQUADS) return state;
      return { ...state, squadNames: [...state.squadNames, op.name] };
    case "removeSquad":
      // A roster always keeps one squad.
      if (op.squad > squads || squads === 1) return state;
      return removeSquadFrom(state, op.squad);
    case "squadEmoji": {
      if (op.squad > squads) return state;
      const squadEmojis: (AnswerEmoji | null)[] = state.squadNames.map(
        (_, i) => state.embedStyle.squadEmojis?.[i] ?? null,
      );
      squadEmojis[op.squad - 1] = op.emoji;
      return { ...state, embedStyle: { ...state.embedStyle, squadEmojis } };
    }
    case "style": {
      const next: Record<string, unknown> = { ...state.embedStyle };
      if (op.value === null || op.value === undefined) delete next[op.field];
      else next[op.field] = op.value;
      const parsed = embedStyleSchema.safeParse(next);
      if (!parsed.success) throw new InvalidOpError(`Invalid value for ${op.field}`);
      return { ...state, embedStyle: parsed.data };
    }
    case "toggle":
      return { ...state, [op.field]: op.value };
    case "answers":
      return { ...state, answerOptions: op.options };
  }
}

/** The server emoji a change would put on the roster, which must be ones the bot listed. */
export function opServerEmojiIds(op: RosterOp): string[] {
  const ids = (emojis: (AnswerEmoji | null | undefined)[]) =>
    emojis.flatMap((e) => (e && "id" in e ? [e.id] : []));
  switch (op.type) {
    case "squadEmoji":
      return ids([op.emoji]);
    case "style": {
      const value = answerEmojiSchema.safeParse(op.value);
      return value.success ? ids([value.data]) : [];
    }
    case "answers":
      return ids(op.options.map((o) => o.emoji));
    default:
      return [];
  }
}
