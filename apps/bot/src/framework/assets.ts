import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";

/** The art the bot sends. None of it is in the repo or the image: ASSETS_DIR holds it. */
export const CLAN_EMBLEMS = [
  "cerberus",
  "blackspear",
  "direhound",
  "deadwatch",
  "dreadnought",
  "deathwing",
];
export const ASSET_FILES = [
  "arachne-banner.webp",
  "arachne-crest.png",
  "arachne-crest-large.png",
  "hero-battlefield.jpg",
  ...CLAN_EMBLEMS.map((clan) => `emblems/${clan}.svg`),
];

/** ASSETS_DIR, or `assets/` at the repo root for a developer. Read on use, so tests can change it. */
const assetsDir = (): string =>
  resolve(
    process.env["ASSETS_DIR"] || fileURLToPath(new URL("../../../../assets", import.meta.url)),
  );

const loaded = new Map<string, Buffer>();

/** The file's bytes, or undefined when it isn't there, so callers go without it. */
export function readAsset(name: string): Buffer | undefined {
  const path = join(assetsDir(), name);
  let bytes = loaded.get(path);
  if (!bytes) {
    try {
      bytes = readFileSync(path);
    } catch {
      return undefined;
    }
    loaded.set(path, bytes);
  }
  return bytes;
}

/** One warning per missing file, at start-up. A missing file never stops the bot. */
export function warnMissingAssets(log: Logger): void {
  const missing = ASSET_FILES.filter((name) => !readAsset(name));
  for (const name of missing) {
    log.warn({ file: name, dir: assetsDir() }, "Asset missing: the bot goes without it");
  }
}

const require = createRequire(import.meta.url);

/** A font file from the @fontsource packages in node_modules. */
export const fontFile = (family: string, file: string): Buffer =>
  readFileSync(require.resolve(`@fontsource/${family}/files/${file}`));
