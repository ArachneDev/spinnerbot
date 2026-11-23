import { DEFAULT_ANSWER_OPTIONS, DEFAULT_SQUAD_NAMES } from "@scrimbot/core";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  guildId: text("guild_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const botJobs = pgTable(
  "bot_jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status", { enum: ["pending", "running", "done", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("bot_jobs_claim_idx")
      .on(table.runAfter)
      .where(sql`${table.status} = 'pending'`),
  ],
);

/** One run of /build-roster. The web page finds it by `token`, which is the private link. */
export const rosterInstances = pgTable(
  "roster_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    guildId: text("guild_id").notNull(),
    /** Where /build-roster was run, and where the final roster is posted. */
    channelId: text("channel_id").notNull(),
    ownerId: text("owner_id").notNull(),
    sourceChannelId: text("source_channel_id").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    /** The EventSnapshot as read when the instance was created. Never changes afterwards. */
    snapshot: jsonb("snapshot").notNull(),
    /** Accepted-player index (as a string) to squad number. Players not listed are the bench. */
    assignments: jsonb("assignments").notNull().default({}),
    /** The seven squad names, in board order. */
    squadNames: jsonb("squad_names").notNull().default(DEFAULT_SQUAD_NAMES),
    /** Squad number (as a string) to the accepted-player index of its squad leader. */
    squadLeaders: jsonb("squad_leaders").notNull().default({}),
    /** Whether the posted roster carries the Arachne banner. */
    showBanner: boolean("show_banner").notNull().default(false),
    /** Whether the posted roster lists the bench. */
    showBench: boolean("show_bench").notNull().default(true),
    /** How the leader dressed the embed. Empty means the Arachne default. */
    embedStyle: jsonb("embed_style").notNull().default({}),
    /** The answer buttons, in order. The first one is the Confirm button the counter counts. */
    answerOptions: jsonb("answer_options").notNull().default(DEFAULT_ANSWER_OPTIONS),
    /** The buttons on the posted message. Answers are checked against these during an edit. */
    postedAnswerOptions: jsonb("posted_answer_options"),
    /** Server emoji the bot listed when the leader opened the button editor. Null until then. */
    emojiOptions: jsonb("emoji_options"),
    status: text("status", { enum: ["draft", "posted", "editing"] })
      .notNull()
      .default("draft"),
    postedMessageId: text("posted_message_id"),
    /** What the posted message shows. The counter uses this while a later edit is in progress. */
    postedAssignments: jsonb("posted_assignments"),
    /** The same, for the squad names, leaders and options the posted message shows. */
    postedSquadNames: jsonb("posted_squad_names"),
    postedSquadLeaders: jsonb("posted_squad_leaders"),
    postedShowBanner: boolean("posted_show_banner"),
    postedShowBench: boolean("posted_show_bench"),
    postedEmbedStyle: jsonb("posted_embed_style"),
    /** Lets the bot edit the private preview for 15 minutes. Only the bot can read these. */
    previewToken: text("preview_token"),
    previewTokenAt: timestamp("preview_token_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Raised by every change to the board, so browsers can tell whether they missed one. */
    revision: integer("revision").notNull().default(0),
  },
  (table) => [index("roster_instances_expires_idx").on(table.expiresAt)],
);

/** The squad names a server's new rosters start with. Any roster leader can overwrite them. */
export const guildRosterDefaults = pgTable("guild_roster_defaults", {
  guildId: text("guild_id").primaryKey(),
  squadNames: jsonb("squad_names").notNull(),
  embedStyle: jsonb("embed_style"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Which Steam account a Discord user is. Filled by the chat import and by members themselves. */
export const steamProfiles = pgTable("steam_profiles", {
  discordUserId: text("discord_user_id").primaryKey(),
  /** The SteamID64. Vanity names and friend codes are converted before they're stored. */
  steamId: text("steam_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Roles that may use every command in a server, besides its admins. Set with `/staff-roles`. */
export const staffRoles = pgTable(
  "staff_roles",
  {
    guildId: text("guild_id").notNull(),
    roleId: text("role_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.roleId] })],
);

/** A listed player's answer on a posted roster. One row per player, replaced when they change it. */
export const rosterResponses = pgTable(
  "roster_responses",
  {
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => rosterInstances.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    /** The key of one of the roster's answer options. */
    answer: text("answer").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.instanceId, table.userId] })],
);
