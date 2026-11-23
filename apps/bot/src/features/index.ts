import { buildRosterFeature } from "./build-roster/index.js";
import type { Feature } from "../framework/types.js";
import { joinLobbyFeature } from "./join-lobby/index.js";
import { pingFeature } from "./ping/index.js";
import { rollFeature } from "./roll/index.js";
import { staffRolesFeature } from "./staff-roles/index.js";
import { systemFeature } from "./system/index.js";

/** Every feature in the bot. `pnpm new:command` adds to this list. */
export const features: Feature[] = [
  systemFeature,
  pingFeature,
  rollFeature,
  buildRosterFeature,
  joinLobbyFeature,
  staffRolesFeature,
];
