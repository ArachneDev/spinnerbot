import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { UserFacingError } from "../src/framework/errors.js";
import { PythonError, createPythonBridge } from "../src/framework/python.js";

const commandsRoot = fileURLToPath(new URL("python-fixtures/", import.meta.url));
const log = pino({ level: "silent" });
const bridge = createPythonBridge({ log, commandsRoot });
const any = z.any();

describe("Python bridge", () => {
  it("round-trips data, including non-ASCII text", async () => {
    const input = { name: "Åsa 🐺", n: 1, nested: { list: [true, null] } };
    const result = await bridge.run("echo", input, z.object({ received: z.any() }));
    expect(result.received).toEqual(input);
  });

  it("keeps print() out of the reply", async () => {
    await expect(bridge.run("echo", {}, any)).resolves.toEqual({ received: {} });
  });

  it("runs async commands", async () => {
    await expect(bridge.run("async_command", {}, any)).resolves.toEqual({ async: true });
  });

  it("gives Python none of the bot's environment", async () => {
    process.env["DISCORD_TOKEN"] = "must-not-leak";
    try {
      const { keys } = await bridge.run("env_keys", {}, z.object({ keys: z.array(z.string()) }));
      expect(keys).not.toContain("DISCORD_TOKEN");
      expect(keys).not.toContain("DATABASE_URL");
    } finally {
      delete process.env["DISCORD_TOKEN"];
    }
  });

  it("shows UserError's message to the user", async () => {
    const run = bridge.run("rejects", {}, any);
    await expect(run).rejects.toBeInstanceOf(UserFacingError);
    await expect(run).rejects.toThrow("Pick a smaller number");
  });

  it.each(["crashes", "exits", "unserializable", "huge", "does_not_exist"])(
    "treats %s as an internal failure, not a message for the user",
    async (name) => {
      await expect(bridge.run(name, {}, any)).rejects.toBeInstanceOf(PythonError);
    },
  );

  it("rejects a result that doesn't match the schema", async () => {
    await expect(bridge.run("echo", {}, z.object({ wrong: z.string() }))).rejects.toBeInstanceOf(
      PythonError,
    );
  });

  it("kills a script that runs past its timeout and tells the user", async () => {
    const started = Date.now();
    await expect(bridge.run("hangs", {}, any, { timeoutMs: 200 })).rejects.toBeInstanceOf(
      UserFacingError,
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it.each(["../evil", "os.path", "Upper", ""])("refuses the command name %j", async (name) => {
    await expect(bridge.run(name, {}, any)).rejects.toThrow(/Invalid Python command name/);
  });

  it("reports a missing interpreter", async () => {
    const broken = createPythonBridge({ log, commandsRoot, pythonBin: "/nonexistent/python" });
    await expect(broken.run("echo", {}, any)).rejects.toThrow(/Could not start/);
  });

  it("limits parallel scripts and still finishes every one", async () => {
    const limited = createPythonBridge({ log, commandsRoot, maxConcurrent: 1 });
    const started = Date.now();
    const results = await Promise.all([1, 2, 3].map(() => limited.run("slow", {}, any)));
    expect(results).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
  });
});
