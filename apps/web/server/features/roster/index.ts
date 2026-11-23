import {
  answerOptionsSchema,
  applyOp,
  assignmentsSchema,
  DEFAULT_SQUAD_NAMES,
  embedStyleSchema,
  emojiCacheSchema,
  InvalidOpError,
  MAX_SQUADS,
  opServerEmojiIds,
  rosterOpSchema,
  squadLeadersSchema,
  squadNamesSchema,
  storedEventSchema,
  SYSTEM_SQUADS,
  styleUsesOnlyKnownEmoji,
  type BoardState,
} from "@scrimbot/core";
import { enqueueJob, schema } from "@scrimbot/db";
import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { WebFeature } from "../../types.js";
import { createCoalescer, createRateLimit, createRosterHub, type RosterEvent } from "./hub.js";

/** The channel the bot notifies on, with a roster's id, after it changes that roster. */
export const ROSTER_CHANNEL = "roster_changed";
const CLIENT_ID = /^[\w-]{1,40}$/;
const NAME_LIMIT = 32;
/** At most the rate limit's burst, so a full batch can always get through. */
const MAX_OPS_PER_REQUEST = 20;
const KEEPALIVE_MS = 25_000;
/** Previews are redrawn at most this often, however many changes arrive. */
const PREVIEW_GAP_MS = 2000;
const opsSchema = z.object({
  clientId: z.string().regex(CLIENT_ID),
  ops: z
    .array(z.object({ id: z.string().regex(CLIENT_ID), op: rosterOpSchema }))
    .min(1)
    .max(MAX_OPS_PER_REQUEST),
});
const presenceSchema = z.object({
  clientId: z.string().regex(CLIENT_ID),
  dragging: z.number().int().min(0).max(1000).nullable(),
});
const defaultNamesSchema = z.object({
  squadNames: squadNamesSchema,
  embedStyle: embedStyleSchema.optional(),
});
/** The emoji list is only refreshed this often, however many times the editor is opened. */
const EMOJI_MAX_AGE_MS = 10 * 60 * 1000;

/** `previewGapMs` is how often a roster's Discord preview may be redrawn. Tests use 0. */
export const createRosterFeature = ({ previewGapMs = PREVIEW_GAP_MS } = {}): WebFeature => ({
  name: "roster",
  routes({ database, log }) {
    const { db } = database;
    const { guildRosterDefaults: defaults, rosterInstances: table } = schema;
    // The token in the link is the only credential, so unknown, expired and wrong all look alike.
    const live = (token: string) => and(eq(table.token, token), gt(table.expiresAt, new Date()));

    /** The parts of a roster that the board changes. */
    const BOARD_COLUMNS = {
      assignments: table.assignments,
      squadLeaders: table.squadLeaders,
      squadNames: table.squadNames,
      showBanner: table.showBanner,
      showBench: table.showBench,
      embedStyle: table.embedStyle,
      answerOptions: table.answerOptions,
      emojiOptions: table.emojiOptions,
      status: table.status,
      revision: table.revision,
    };
    const boardOf = (row: Record<keyof typeof BOARD_COLUMNS, unknown>): BoardState => ({
      assignments: assignmentsSchema.parse(row.assignments),
      squadLeaders: squadLeadersSchema.parse(row.squadLeaders),
      squadNames: squadNamesSchema.parse(row.squadNames),
      showBanner: row.showBanner as boolean,
      showBench: row.showBench as boolean,
      embedStyle: embedStyleSchema.parse(row.embedStyle),
      answerOptions: answerOptionsSchema.parse(row.answerOptions),
    });

    const hub = createRosterHub();
    const allowOps = createRateLimit(20, 40);
    const allowPresence = createRateLimit(5, 10);
    const requestPreview = createCoalescer(previewGapMs, (id) =>
      enqueueJob(db, "roster.preview", { id }).then(
        () => undefined,
        (error: unknown) =>
          log.warn({ err: error, roster: id }, "Could not queue a preview redraw"),
      ),
    );

    // The bot posts, edits, discards and deletes rosters, and says so with pg_notify. Browsers
    // then load the roster again, or stop if it is gone. Started with the first stream, so a
    // web app nobody is editing on holds no extra connection.
    let listening: Promise<void> | undefined;
    async function onBotChange(id: string) {
      if (!hub.has(id)) return;
      const [row] = await db
        .select({ status: table.status, revision: table.revision, expiresAt: table.expiresAt })
        .from(table)
        .where(eq(table.id, id));
      if (!row || row.status === "posted" || row.expiresAt.getTime() <= Date.now()) hub.close(id);
      else hub.publish(id, { type: "reset", revision: row.revision });
    }
    function listenForBot(): Promise<void> {
      listening ??= database.sql
        .listen(ROSTER_CHANNEL, (id) => {
          onBotChange(id).catch((error: unknown) =>
            log.warn({ err: error, roster: id }, "Could not pass on a roster change"),
          );
        })
        .then(
          () => undefined,
          (error: unknown) => {
            // Pages still poll, so the stream goes ahead, and the next one tries again.
            listening = undefined;
            log.warn({ err: error }, "Could not listen for roster changes");
          },
        );
      return listening;
    }

    return (
      new Hono()
        .get("/:token", async (c) => {
          const [row] = await db
            .select({
              snapshot: table.snapshot,
              assignments: table.assignments,
              answerOptions: table.answerOptions,
              guildId: table.guildId,
              squadNames: table.squadNames,
              squadLeaders: table.squadLeaders,
              showBanner: table.showBanner,
              showBench: table.showBench,
              embedStyle: table.embedStyle,
              status: table.status,
              expiresAt: table.expiresAt,
              revision: table.revision,
            })
            .from(table)
            .where(live(c.req.param("token")));
          if (!row) return c.json({ error: "Not found" }, 404);
          const event = storedEventSchema.parse(row.snapshot);
          const [saved] = await db
            .select({ squadNames: defaults.squadNames, embedStyle: defaults.embedStyle })
            .from(defaults)
            .where(eq(defaults.guildId, row.guildId));
          return c.json({
            event,
            assignments: assignmentsSchema.parse(row.assignments),
            answerOptions: answerOptionsSchema.parse(row.answerOptions),
            squadNames: squadNamesSchema.parse(row.squadNames),
            squadLeaders: squadLeadersSchema.parse(row.squadLeaders),
            showBanner: row.showBanner,
            showBench: row.showBench,
            embedStyle: embedStyleSchema.parse(row.embedStyle),
            defaultEmbedStyle: saved?.embedStyle ? embedStyleSchema.parse(saved.embedStyle) : {},
            maxSquads: MAX_SQUADS,
            defaultSquadNames: saved
              ? squadNamesSchema.parse(saved.squadNames)
              : DEFAULT_SQUAD_NAMES,
            systemSquads: SYSTEM_SQUADS,
            status: row.status,
            expiresAt: row.expiresAt,
            revision: row.revision,
          });
        })
        .post("/:token/ops", async (c) => {
          const body = opsSchema.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ error: "Invalid change" }, 400);
          const token = c.req.param("token");
          if (!allowOps(token, body.data.ops.length)) {
            return c.json({ error: "Too many changes. Wait a moment." }, 429);
          }
          const { clientId, ops } = body.data;

          // The row is locked, so changes from several browsers apply one after another.
          const result = await db.transaction(async (tx) => {
            const [row] = await tx
              .select({ id: table.id, snapshot: table.snapshot, ...BOARD_COLUMNS })
              .from(table)
              .where(live(token))
              .for("update");
            if (!row) return { error: "Not found", status: 404 } as const;
            if (row.status === "posted") {
              return { error: "This roster is already posted", status: 409 } as const;
            }
            const players = storedEventSchema.parse(row.snapshot).responses.accepted.length;
            const cache = row.emojiOptions ? emojiCacheSchema.parse(row.emojiOptions) : null;
            const known = new Set(cache?.emojis.map((e) => e.id));
            let state = boardOf(row);
            const events: Extract<RosterEvent, { type: "op" }>[] = [];
            for (const { id, op } of ops) {
              // A server emoji must be one the bot listed for this server, never an arbitrary id.
              if (opServerEmojiIds(op).some((emoji) => !known.has(emoji))) {
                return { error: "Unknown server emoji", status: 400 } as const;
              }
              try {
                state = applyOp(state, op, players);
              } catch (error) {
                if (error instanceof InvalidOpError) {
                  return { error: error.message, status: 400 } as const;
                }
                throw error;
              }
              events.push({
                type: "op",
                revision: row.revision + events.length + 1,
                clientId,
                opId: id,
                op,
              });
            }
            const revision = row.revision + events.length;
            await tx
              .update(table)
              .set({ ...state, revision })
              .where(eq(table.id, row.id));
            return { id: row.id, revision, state, events };
          });
          if ("error" in result) return c.json({ error: result.error }, result.status);

          for (const event of result.events) hub.publish(result.id, event);
          await requestPreview(result.id);
          return c.json({ revision: result.revision, state: result.state });
        })
        // Changes from everyone else, as they happen. A dropped stream is retried by the browser.
        .get("/:token/events", async (c) => {
          const clientId = c.req.query("clientId") ?? "";
          if (!CLIENT_ID.test(clientId)) return c.json({ error: "Invalid client" }, 400);
          const name = (c.req.query("name") ?? "").trim().slice(0, NAME_LIMIT) || "Editor";
          const [row] = await db
            .select({
              id: table.id,
              revision: table.revision,
              status: table.status,
              expiresAt: table.expiresAt,
            })
            .from(table)
            .where(live(c.req.param("token")));
          if (!row) return c.json({ error: "Not found" }, 404);
          if (row.status === "posted")
            return c.json({ error: "This roster is already posted" }, 409);
          // Listening first, so a change the bot makes as the stream opens isn't missed.
          await listenForBot();

          // Cloudflare drops a quiet connection after about 100 s, and compressing would hold
          // events back, so the stream is sent as it is and kept alive.
          const response = streamSSE(c, async (stream) => {
            let open = true;
            // Writes go one after another, so closing can wait for the last of them.
            let writing = Promise.resolve();
            const send = (event: RosterEvent) => {
              if (!open) return;
              writing = writing
                .then(() => stream.writeSSE({ event: event.type, data: JSON.stringify(event) }))
                .catch(() => {
                  open = false;
                });
            };
            // First, so the page knows where the board is before anything else arrives.
            send({ type: "hello", revision: row.revision, clientId });
            const leave = hub.subscribe(row.id, {
              clientId,
              name,
              dragging: null,
              send,
              close: () => {
                open = false;
                void writing.then(() => stream.close());
              },
            });
            stream.onAbort(() => {
              open = false;
              leave();
            });
            while (open && !stream.aborted) {
              await stream.sleep(KEEPALIVE_MS);
              if (!open || stream.aborted) break;
              if (row.expiresAt.getTime() <= Date.now()) {
                send({ type: "closed" });
                break;
              }
              writing = writing
                .then(() => stream.write(": keepalive\n\n"))
                .then(
                  () => undefined,
                  () => {
                    open = false;
                  },
                );
            }
            open = false;
            leave();
            await writing;
          });
          // Hono sets plain no-cache, so these are added after it.
          response.headers.set("Cache-Control", "no-cache, no-transform");
          response.headers.set("X-Accel-Buffering", "no");
          return response;
        })
        // Which player an editor is dragging, so the others can see it. Never stored.
        .post("/:token/presence", async (c) => {
          const body = presenceSchema.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ error: "Invalid presence" }, 400);
          const token = c.req.param("token");
          if (!allowPresence(`${token}:${body.data.clientId}`)) {
            return c.json({ error: "Too many updates" }, 429);
          }
          const [row] = await db.select({ id: table.id }).from(table).where(live(token));
          if (!row) return c.json({ error: "Not found" }, 404);
          hub.setDragging(row.id, body.data.clientId, body.data.dragging);
          return c.body(null, 204);
        })
        .put("/:token/default-squad-names", async (c) => {
          const body = defaultNamesSchema.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ error: "Invalid squad names" }, 400);

          const [row] = await db
            .select({ guildId: table.guildId, emojiOptions: table.emojiOptions })
            .from(table)
            .where(live(c.req.param("token")));
          if (!row) return c.json({ error: "Not found" }, 404);

          const { squadNames, embedStyle = {} } = body.data;
          const cache = row.emojiOptions ? emojiCacheSchema.parse(row.emojiOptions) : null;
          if (!styleUsesOnlyKnownEmoji(embedStyle, cache)) {
            return c.json({ error: "Unknown server emoji" }, 400);
          }
          await db
            .insert(defaults)
            .values({ guildId: row.guildId, squadNames, embedStyle })
            .onConflictDoUpdate({
              target: defaults.guildId,
              set: { squadNames, embedStyle, updatedAt: new Date() },
            });
          return c.json({ squadNames });
        })
        // The emoji list is only fetched once the leader opens the button editor.
        .get("/:token/emojis", async (c) => {
          const [row] = await db
            .select({ emojiOptions: table.emojiOptions })
            .from(table)
            .where(live(c.req.param("token")));
          if (!row) return c.json({ error: "Not found" }, 404);
          return c.json({
            cache: row.emojiOptions ? emojiCacheSchema.parse(row.emojiOptions) : null,
          });
        })
        .post("/:token/emojis", async (c) => {
          const [row] = await db
            .select({ id: table.id, emojiOptions: table.emojiOptions })
            .from(table)
            .where(live(c.req.param("token")));
          if (!row) return c.json({ error: "Not found" }, 404);

          const cache = row.emojiOptions ? emojiCacheSchema.safeParse(row.emojiOptions) : null;
          const fresh =
            cache?.success &&
            Date.now() - new Date(cache.data.loadedAt).getTime() < EMOJI_MAX_AGE_MS;
          if (!fresh) await enqueueJob(db, "roster.emojis", { id: row.id });
          return c.json({ requested: !fresh }, 202);
        })
    );
  },
});

export const rosterFeature = createRosterFeature();
