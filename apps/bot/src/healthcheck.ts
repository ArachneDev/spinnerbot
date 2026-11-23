import { heartbeatIsFresh } from "./framework/heartbeat.js";

// Prints the build version, as /healthz does for the web, then exits 0 while the bot is alive.
console.log(process.env["VERSION"] ?? "dev");
process.exit(heartbeatIsFresh() ? 0 : 1);
