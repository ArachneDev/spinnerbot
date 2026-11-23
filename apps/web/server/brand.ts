import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import type { Logger } from "pino";

/** The art the page shows. None of it is in the repo or the image: ASSETS_DIR holds it. */
const BRAND_FILES: Record<string, string> = {
  "arachne-banner.webp": "image/webp",
  "arachne-crest.png": "image/png",
  "arachne-crest-large.png": "image/png",
  "hero-battlefield.jpg": "image/jpeg",
  "spinner-bot-icon.jpg": "image/jpeg",
};

/** ASSETS_DIR, or `assets/` at the repo root, found by walking up to the workspace file. */
export function assetsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env["ASSETS_DIR"]) return resolve(env["ASSETS_DIR"]);
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml")) && dirname(dir) !== dir) dir = dirname(dir);
  return join(dir, "assets");
}

/** One warning per missing file, at start-up. The page works without the art. */
export function warnMissingBrand(dir: string, log: Logger): void {
  for (const name of Object.keys(BRAND_FILES)) {
    if (!existsSync(join(dir, name))) {
      log.warn({ file: name, dir }, "Asset missing: /brand/ answers 404 for it");
    }
  }
}

/** Serves `/brand/<file>` from the folder, for the names above only, so no path can escape it. */
export function serveBrand(app: Hono, dir: string): void {
  app.get("/brand/:file", async (c) => {
    const name = c.req.param("file");
    const type = Object.hasOwn(BRAND_FILES, name) ? BRAND_FILES[name] : undefined;
    if (!type) return c.body(null, 404);
    try {
      const bytes = await readFile(join(dir, name));
      return c.body(new Uint8Array(bytes), 200, {
        "Content-Type": type,
        "Cache-Control": "public, max-age=3600",
      });
    } catch {
      return c.body(null, 404);
    }
  });
}
