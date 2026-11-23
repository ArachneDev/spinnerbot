import {
  parseSteamProfilePage,
  steamProfileUrl,
  type SteamProfilePage,
  type SteamRef,
} from "@scrimbot/core";

// Steam answers with HTTP 429 after a short burst of profile pages, and there is no public API for
// the join link. So every request in the bot goes through one queue, and results are kept briefly:
// a voice scan and the button presses that follow it would otherwise ask for the same pages.

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const REQUEST_GAP_MS = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const RESULT_TTL_MS = 30_000;
const DEFAULT_PAUSE_MS = 20_000;
const MAX_PAUSE_MS = 60_000;

export type SteamCheck =
  | { status: "found"; page: SteamProfilePage }
  /** Steam answered, and there is no such profile. */
  | { status: "missing" }
  /** Steam didn't answer properly, so nothing is known. Worth trying again later. */
  | { status: "unavailable" };

export interface SteamClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SteamClient {
  check(ref: SteamRef): Promise<SteamCheck>;
}

function pauseFor(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return seconds > 0 ? Math.min(seconds * 1000, MAX_PAUSE_MS) : DEFAULT_PAUSE_MS;
}

export function createSteamClient({
  fetch: request = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: SteamClientOptions = {}): SteamClient {
  const results = new Map<string, { expires: number; result: Promise<SteamCheck> }>();
  let queue: Promise<unknown> = Promise.resolve();
  let notBefore = 0;
  /** After a retry was refused too, whatever is queued gives up at once instead of waiting. */
  let givingUpUntil = 0;

  async function waitForTurn(): Promise<void> {
    const wait = notBefore - now();
    if (wait > 0) await sleep(wait);
  }

  async function get(url: string): Promise<Response> {
    await waitForTurn();
    notBefore = now() + REQUEST_GAP_MS;
    return request(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async function load(url: string): Promise<SteamCheck> {
    if (now() < givingUpUntil) return { status: "unavailable" };
    let response = await get(url);
    if (response.status === 429) {
      const pause = pauseFor(response);
      notBefore = now() + pause;
      response = await get(url);
      if (response.status === 429) {
        givingUpUntil = now() + pauseFor(response);
        notBefore = givingUpUntil;
        return { status: "unavailable" };
      }
    }
    if (!response.ok) return { status: response.status === 404 ? "missing" : "unavailable" };
    const page = parseSteamProfilePage(await response.text());
    return page ? { status: "found", page } : { status: "missing" };
  }

  function enqueue(url: string): Promise<SteamCheck> {
    const result = queue.then(() => load(url));
    queue = result.catch(() => undefined);
    return result.catch((): SteamCheck => ({ status: "unavailable" }));
  }

  return {
    check(ref) {
      const url = steamProfileUrl(ref);
      const cached = results.get(url);
      if (cached && cached.expires > now()) return cached.result;

      const result = enqueue(url);
      const entry = { expires: now() + RESULT_TTL_MS, result };
      for (const [key, { expires }] of results) if (expires <= now()) results.delete(key);
      results.set(url, entry);
      // Only an answer from Steam is worth keeping.
      void result.then(({ status }) => {
        if (status === "unavailable" && results.get(url) === entry) results.delete(url);
      });
      return result;
    },
  };
}

/** The bot's one client, so every Steam request shares the same queue. */
export const steam = createSteamClient();
