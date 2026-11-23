import { fileURLToPath } from "node:url";
import { formatFile, scaffoldCommand } from "./scaffold.js";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const python = args.includes("--python");
const name = args.find((arg) => !arg.startsWith("--"));

if (!name) {
  console.error("Usage: pnpm new:command <name> [--python]");
  process.exit(1);
}

const root = fileURLToPath(new URL("../../../../", import.meta.url));

try {
  const { created, updated } = scaffoldCommand(root, name, python);
  formatFile(root, updated);
  console.log(`Created /${name}:`);
  for (const file of created) console.log(`  ${file}`);
  console.log(`Added it to ${updated}\n`);
  console.log("Next:");
  console.log("  1. Fill in the TODOs and the inputs in options.");
  console.log("  2. pnpm commands:deploy    so Discord shows the command");
  console.log("  3. pnpm dev:bot            then try it");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
