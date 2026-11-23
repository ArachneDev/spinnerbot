import type { WebFeature } from "../types.js";
import { joinLobbyFeature } from "./join-lobby/index.js";
import { rosterFeature } from "./roster/index.js";
import { systemFeature } from "./system/index.js";

/** Every API feature. Adding one takes one line here. */
export const webFeatures: WebFeature[] = [systemFeature, rosterFeature, joinLobbyFeature];
