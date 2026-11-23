import { type AppRole, devRoleUrl } from "./dev-roles.js";

// Development only: prints the owner's DATABASE_URL (from .env) rewritten to log in as one role.
// Used by scripts/dev.sh, so the web API and the bot can run as their restricted roles.
const url = process.env["DATABASE_URL"];
const role = process.argv[2] as AppRole | undefined;
if (!url || (role !== "scrimbot_bot" && role !== "scrimbot_web")) {
  throw new Error("Usage: role-url <scrimbot_bot|scrimbot_web>, with DATABASE_URL set");
}
process.stdout.write(devRoleUrl(url, role));
