import { type Logger, pino } from "pino";

export type { Logger };

export function createLogger(level = "info"): Logger {
  return pino({ level, base: { app: "bot" } });
}
