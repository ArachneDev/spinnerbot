import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { UserFacingError } from "./errors.js";
import type { Logger } from "./logger.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT = 4;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_LOGGED_STDERR = 8 * 1024;
const COMMAND_NAME = /^[a-z][a-z0-9_]*$/;

const PYTHON_ROOT = fileURLToPath(new URL("../../../../python/", import.meta.url));

/** A Python command failed in a way the user can't fix. They get the generic failure message. */
export class PythonError extends Error {
  override name = "PythonError";
}

const envelope = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export interface PythonRunOptions {
  /** How long the script may run. Deferred commands can wait up to 15 minutes in total. */
  timeoutMs?: number;
}

export interface PythonBridge {
  /**
   * Runs `run(data)` in python/commands/<name>.py and returns its result, checked against
   * `schema`. Raising UserError in Python becomes a message to the user.
   */
  run<S extends z.ZodType>(
    name: string,
    input: unknown,
    schema: S,
    options?: PythonRunOptions,
  ): Promise<z.output<S>>;
}

export interface PythonBridgeOptions {
  log: Logger;
  /** The interpreter. By default python/.venv if it exists, otherwise python3 from PATH. */
  pythonBin?: string | undefined;
  /** The folder holding commands/. Tests point this at their fixtures. */
  commandsRoot?: string;
  maxConcurrent?: number;
}

function defaultPythonBin(): string {
  const venv = `${PYTHON_ROOT}.venv/bin/python`;
  return existsSync(venv) ? venv : "python3";
}

export function createPythonBridge(options: PythonBridgeOptions): PythonBridge {
  const { log, commandsRoot = PYTHON_ROOT, maxConcurrent = MAX_CONCURRENT } = options;
  const pythonBin = options.pythonBin || defaultPythonBin();

  let running = 0;
  const waiting: (() => void)[] = [];

  /** Limits parallel scripts, so a burst of commands can't exhaust the container's memory. */
  async function withSlot<T>(work: () => Promise<T>): Promise<T> {
    if (running >= maxConcurrent) await new Promise<void>((resolve) => waiting.push(resolve));
    else running += 1;
    try {
      return await work();
    } finally {
      // The slot passes straight to the next in line, or is released.
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  }

  function execute(name: string, input: unknown, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const scriptLog = log.child({ python: name });
      // -I ignores PYTHON* variables and the current folder. -B writes no .pyc files, since the
      // container's filesystem is read-only. The clean env keeps the bot's secrets out.
      const child = spawn(
        pythonBin,
        ["-I", "-B", "-X", "utf8", `${PYTHON_ROOT}runner.py`, name, commandsRoot],
        { env: { PATH: process.env["PATH"] ?? "" }, stdio: ["pipe", "pipe", "pipe"] },
      );

      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderr = "";
      let failure: Error | undefined;

      const stop = (error: Error) => {
        failure ??= error;
        child.kill("SIGKILL");
      };

      const timer = setTimeout(() => {
        scriptLog.warn({ timeoutMs }, "Python command timed out");
        stop(new UserFacingError("The request took too long and was stopped. Please try again."));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          stop(new PythonError(`Python command ${name} returned over ${MAX_OUTPUT_BYTES} bytes`));
        } else {
          stdout.push(chunk);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_LOGGED_STDERR);
      });
      // The script may exit without reading its input. The exit is handled below.
      child.stdin.on("error", () => {});
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new PythonError(`Could not start ${pythonBin}: ${error.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (stderr) scriptLog.info({ stderr }, "Python command wrote to stderr");
        if (failure) {
          reject(failure);
          return;
        }
        try {
          const parsed = envelope.parse(JSON.parse(Buffer.concat(stdout).toString()));
          if (parsed.ok) resolve(parsed.result);
          else reject(new UserFacingError(parsed.error));
        } catch {
          reject(new PythonError(`Python command ${name} failed (exit code ${code}): ${stderr}`));
        }
      });

      child.stdin.end(JSON.stringify(input));
    });
  }

  return {
    async run(name, input, schema, runOptions = {}) {
      if (!COMMAND_NAME.test(name)) throw new PythonError(`Invalid Python command name "${name}"`);
      const result = await withSlot(() =>
        execute(name, input, runOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      );
      const parsed = schema.safeParse(result);
      if (!parsed.success) {
        throw new PythonError(
          `Python command ${name} returned an unexpected result: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    },
  };
}
