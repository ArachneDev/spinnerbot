import type { Logger } from "./logger.js";

/**
 * Runs `attempt` until it succeeds, waiting longer after each failure (1 s, doubling, at most 60 s)
 * and logging each one. The bot keeps running meanwhile, so the container stays up.
 */
export async function retryWithBackoff<T>(
  what: string,
  attempt: () => Promise<T>,
  log: Logger,
  { initialMs = 1_000, maxMs = 60_000 } = {},
): Promise<T> {
  for (let delay = initialMs; ; delay = Math.min(delay * 2, maxMs)) {
    try {
      return await attempt();
    } catch (error) {
      log.error({ err: error }, `${what} failed. Trying again in ${Math.round(delay / 1000)} s.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
