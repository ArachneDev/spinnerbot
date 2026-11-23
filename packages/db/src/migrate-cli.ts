import { readFileSync } from "node:fs";
import { runMigrations } from "./migrate.js";

const fromFile = process.env["DATABASE_URL_FILE"];
const url = fromFile ? readFileSync(fromFile, "utf8").trim() : process.env["DATABASE_URL"];
if (!url) throw new Error("Set DATABASE_URL or DATABASE_URL_FILE");

await runMigrations(url);
console.log("Migrations applied");
