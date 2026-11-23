import { ButtonStyle, DiscordAPIError, Routes } from "discord.js";
import { eq } from "drizzle-orm";
import { answerOptionsSchema, assignmentsSchema, storedEventSchema } from "@scrimbot/core";
import { schema } from "@scrimbot/db";
import type { FeatureContext } from "../../framework/types.js";
import { createThrottle } from "./throttle.js";
import { draftDisplay } from "./display.js";
import { forgetPreviewImage, ROSTER_IMAGE_FILE } from "./roster-image.js";
import {
  button,
  buttons,
  previewAnswers,
  rosterEmbed,
  rosterFiles,
  type LivePreview,
} from "./view.js";

const { rosterInstances: table } = schema;
type Instance = typeof table.$inferSelect;

/** Discord interaction tokens work for 15 minutes. Stop a minute early rather than fail. */
const TOKEN_LIFETIME_MS = 14 * 60 * 1000;
/** Edits closer together than this are merged into one, which keeps us inside Discord's limits. */
const MIN_EDIT_GAP_MS = 2000;

const unixTime = (date: Date) => Math.floor(date.getTime() / 1000);

/** The private message the leader sees while building: link, live preview and buttons. */
export async function draftMessage(row: Instance, publicUrl: string, live?: LivePreview) {
  const event = storedEventSchema.parse(row.snapshot);
  const display = draftDisplay(row);
  const options = answerOptionsSchema.parse(row.answerOptions);
  const assignments = assignmentsSchema.parse(row.assignments);
  const embed = rosterEmbed(event, assignments, new Map(), options, {
    preview: true,
    display,
  });
  const files = await rosterFiles(event, assignments, display, live);
  // A live preview may have no roster picture yet. It shows none rather than a broken one.
  if (
    embed.data.image?.url?.endsWith(ROSTER_IMAGE_FILE) &&
    !files.some((f) => f.name === ROSTER_IMAGE_FILE)
  ) {
    embed.setImage(null);
  }
  const editing = row.status === "editing";
  const { accepted } = event.responses;
  const matched = accepted.filter((p) => p.discordUserId).length;
  const liveUntil = row.previewTokenAt
    ? ` · preview live until <t:${unixTime(new Date(row.previewTokenAt.getTime() + TOKEN_LIFETIME_MS))}:t>`
    : "";
  return {
    content: [
      `### ${editing ? "Editing the posted roster" : "Roster draft"}`,
      `**[Open the roster builder](${publicUrl}/r/${row.token})** · private link, expires <t:${unixTime(row.expiresAt)}:R>`,
      editing
        ? "The posted roster stays unchanged until you press **Update roster**."
        : "Press **Post roster** when it looks right.",
      `-# ${matched} of ${accepted.length} players matched to Discord${liveUntil}`,
    ].join("\n"),
    embeds: [embed],
    files,
    // Replaces the pictures from the last redraw, rather than adding to them.
    attachments: [],
    components: [
      previewAnswers(options),
      editing
        ? buttons(
            button("Update roster", ButtonStyle.Success, "post", row.id),
            button("Refresh preview", ButtonStyle.Secondary, "refresh", row.id),
            button("Discard changes", ButtonStyle.Danger, "discard", row.id),
          )
        : buttons(
            button("Post roster", ButtonStyle.Success, "post", row.id),
            button("Refresh preview", ButtonStyle.Secondary, "refresh", row.id),
            button("Cancel", ButtonStyle.Danger, "cancel", row.id),
          ),
    ],
  };
}

async function render(context: FeatureContext, id: string) {
  const {
    client,
    database: { db },
    publicUrl,
  } = context;
  const [row] = await db.select().from(table).where(eq(table.id, id));
  if (!row || row.status === "posted" || !row.previewToken || !row.previewTokenAt) return;
  if (Date.now() - row.previewTokenAt.getTime() > TOKEN_LIFETIME_MS) return;

  const { content, embeds, components, files } = await draftMessage(row, publicUrl, {
    id,
    onImageReady: () => void refreshPreview(context, id),
  });
  await client.rest.patch(
    Routes.webhookMessage(client.application!.id, row.previewToken, "@original"),
    {
      body: {
        content,
        embeds: embeds.map((e) => e.toJSON()),
        components: components.map((c) => c.toJSON()),
        attachments: files.map(({ name }, id) => ({ id, filename: name })),
      },
      files: files.map(({ name, attachment }) => ({ name, data: attachment })),
    },
  );
}

const throttle = createThrottle(MIN_EDIT_GAP_MS);

/** Discord answers these when the token is dead. Retrying would only add invalid requests. */
const DEAD_TOKEN_STATUSES = new Set([401, 403, 404]);

/** Redraws one preview, at most once per MIN_EDIT_GAP_MS. Safe to call repeatedly. */
export function refreshPreview(context: FeatureContext, id: string): Promise<void> {
  const {
    database: { db },
    log,
  } = context;
  throttle.schedule(
    id,
    () => render(context, id),
    async (error: unknown) => {
      if (error instanceof DiscordAPIError && DEAD_TOKEN_STATUSES.has(error.status)) {
        // Stop editing until the leader presses Refresh preview, rather than keep failing.
        await db
          .update(table)
          .set({ previewToken: null, previewTokenAt: null })
          .where(eq(table.id, id));
        log.info({ roster: id, status: error.status }, "Preview token no longer works");
        return;
      }
      log.warn({ err: error, roster: id }, "Could not update the roster preview");
    },
  );
  return Promise.resolve();
}

/** Forget throttle state once an instance is gone. */
export function forgetPreview(id: string): void {
  throttle.forget(id);
  forgetPreviewImage(id);
}
