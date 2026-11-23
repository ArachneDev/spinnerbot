import {
  DEFAULT_SQUAD_NAMES,
  embedStyleSchema,
  squadLeadersSchema,
  squadNamesSchema,
  type EmbedStyle,
  type SquadLeaders,
} from "@scrimbot/core";
import type { schema } from "@scrimbot/db";

type Instance = typeof schema.rosterInstances.$inferSelect;

/** How a roster is shown, as opposed to who is on it. */
export interface RosterDisplay {
  squadNames: string[];
  squadLeaders: SquadLeaders;
  showBanner: boolean;
  showBench: boolean;
  embedStyle: EmbedStyle;
}

export const DEFAULT_DISPLAY: RosterDisplay = {
  squadNames: DEFAULT_SQUAD_NAMES,
  squadLeaders: {},
  showBanner: false,
  showBench: true,
  embedStyle: {},
};

/** What the leader is working on. */
export const draftDisplay = (row: Instance): RosterDisplay => ({
  squadNames: squadNamesSchema.parse(row.squadNames),
  squadLeaders: squadLeadersSchema.parse(row.squadLeaders),
  showBanner: row.showBanner,
  showBench: row.showBench,
  embedStyle: embedStyleSchema.parse(row.embedStyle),
});

/** What the posted message shows. A roster being edited may already hold newer values. */
export const postedDisplay = (row: Instance): RosterDisplay => ({
  squadNames: squadNamesSchema.parse(row.postedSquadNames ?? row.squadNames),
  squadLeaders: squadLeadersSchema.parse(row.postedSquadLeaders ?? row.squadLeaders),
  showBanner: row.postedShowBanner ?? row.showBanner,
  showBench: row.postedShowBench ?? row.showBench,
  embedStyle: embedStyleSchema.parse(row.postedEmbedStyle ?? row.embedStyle),
});
