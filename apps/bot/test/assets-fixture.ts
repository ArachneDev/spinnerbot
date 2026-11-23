import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll } from "vitest";

/** A real 1x1 PNG. The real art is not in the repo, so tests make their own tiny files. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Points ASSETS_DIR at a temp folder holding just these files, for the tests in this file. */
export function useAssets(files: Record<string, Buffer | string>): void {
  const before = process.env["ASSETS_DIR"];
  const dir = mkdtempSync(join(tmpdir(), "assets-"));
  beforeAll(() => {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    process.env["ASSETS_DIR"] = dir;
  });
  afterAll(() => {
    if (before === undefined) delete process.env["ASSETS_DIR"];
    else process.env["ASSETS_DIR"] = before;
    rmSync(dir, { recursive: true, force: true });
  });
}
