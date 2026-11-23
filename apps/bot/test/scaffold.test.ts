import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldCommand } from "../src/scripts/scaffold.js";

let root: string;
const index = "apps/bot/src/features/index.ts";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-"));
  mkdirSync(join(root, "apps/bot/src/features"), { recursive: true });
  writeFileSync(
    join(root, index),
    `import type { Feature } from "../framework/types.js";\n\nexport const features: Feature[] = [systemFeature, pingFeature];\n`,
  );
});
afterEach(() => rmSync(root, { recursive: true }));

describe("scaffoldCommand", () => {
  it("creates a TypeScript command with no Python files", () => {
    const { created } = scaffoldCommand(root, "team-stats", false);
    expect(created).toEqual(["apps/bot/src/features/team-stats/index.ts"]);
    expect(existsSync(join(root, "python"))).toBe(false);
    const text = readFileSync(join(root, index), "utf8");
    expect(text).toContain('import { teamStatsFeature } from "./team-stats/index.js";');
    expect(text).toContain("[systemFeature, pingFeature, teamStatsFeature]");
  });

  it("creates the Python files too, with an underscored module name", () => {
    const { created } = scaffoldCommand(root, "team-stats", true);
    expect(created).toContain("python/commands/team_stats.py");
    expect(created).toContain("python/tests/test_team_stats.py");
    const feature = readFileSync(join(root, created[0]!), "utf8");
    expect(feature).toContain('python.run("team_stats"');
  });

  it("handles a feature list that spans several lines", () => {
    writeFileSync(
      join(root, index),
      `export const features: Feature[] = [\n  systemFeature,\n  pingFeature,\n];\n`,
    );
    scaffoldCommand(root, "stats", false);
    expect(readFileSync(join(root, index), "utf8")).toContain("pingFeature, statsFeature]");
  });

  it("refuses to overwrite an existing command", () => {
    scaffoldCommand(root, "stats", false);
    const before = readFileSync(join(root, index), "utf8");
    expect(() => scaffoldCommand(root, "stats", false)).toThrow(/already exists/);
    expect(readFileSync(join(root, index), "utf8")).toBe(before);
  });

  it.each(["Bad", "has space", "../evil", "under_score", "-x", "1a"])(
    "refuses the name %j",
    (name) => {
      expect(() => scaffoldCommand(root, name, false)).toThrow(/lowercase/);
    },
  );
});
