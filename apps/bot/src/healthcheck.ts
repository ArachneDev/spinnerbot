import { heartbeatIsFresh } from "./framework/heartbeat.js";

process.exit(heartbeatIsFresh() ? 0 : 1);
