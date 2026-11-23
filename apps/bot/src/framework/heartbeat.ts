import { readFileSync, writeFileSync } from "node:fs";

const FILE = "/tmp/scrimbot-bot-heartbeat";
const MAX_AGE_MS = 90_000;

/** The bot exposes no port, so the container health check reads this file instead. */
export function writeHeartbeat(): void {
  writeFileSync(FILE, String(Date.now()));
}

export function heartbeatIsFresh(now = Date.now()): boolean {
  try {
    return now - Number(readFileSync(FILE, "utf8")) < MAX_AGE_MS;
  } catch {
    return false;
  }
}
