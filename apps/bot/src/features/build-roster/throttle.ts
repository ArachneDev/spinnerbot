/**
 * Runs a task for a key at most once per `gapMs`. Calls that arrive sooner are merged into one
 * run after the gap, so the last change always lands and a burst costs a single request.
 *
 * Discord's per-route limits are read from response headers, so we can't hard-code them. discord.js
 * waits out any 429 for us, and this keeps us well below the point where that happens.
 */
export function createThrottle(gapMs: number) {
  const lastRun = new Map<string, number>();
  const pending = new Map<string, NodeJS.Timeout>();

  return {
    schedule(key: string, task: () => Promise<void>, onError: (error: unknown) => void): void {
      const run = () => {
        pending.delete(key);
        lastRun.set(key, Date.now());
        void task().catch(onError);
      };
      const wait = (lastRun.get(key) ?? 0) + gapMs - Date.now();
      if (wait <= 0) return run();
      if (!pending.has(key)) pending.set(key, setTimeout(run, wait));
    },
    forget(key: string): void {
      clearTimeout(pending.get(key));
      pending.delete(key);
      lastRun.delete(key);
    },
  };
}
