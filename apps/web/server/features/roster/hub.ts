import type { RosterOp } from "@scrimbot/core";

/** What a browser on a roster's page is told. */
export type RosterEvent =
  /** Sent first, so a browser that reconnects can tell whether it missed changes. */
  | { type: "hello"; revision: number; clientId: string }
  | { type: "op"; revision: number; clientId: string; opId: string; op: RosterOp }
  /** The bot changed the roster, so the browser should load it again. */
  | { type: "reset"; revision: number }
  /** Posted, deleted or expired. Nothing more will arrive. */
  | { type: "closed" }
  | { type: "presence"; editors: Editor[] };

export interface Editor {
  clientId: string;
  name: string;
  /** The player this editor is dragging, if any. */
  dragging: number | null;
}

interface Subscriber extends Editor {
  send(event: RosterEvent): void;
  close(): void;
}

/**
 * Who is on each roster's page, and how to reach them. It lives in this process's memory, which
 * works because the web app runs as one process.
 */
export function createRosterHub() {
  const rooms = new Map<string, Set<Subscriber>>();

  const editors = (id: string): Editor[] =>
    [...(rooms.get(id) ?? [])].map(({ clientId, name, dragging }) => ({
      clientId,
      name,
      dragging,
    }));

  function publish(id: string, event: RosterEvent): void {
    for (const subscriber of rooms.get(id) ?? []) subscriber.send(event);
  }
  const announce = (id: string) => publish(id, { type: "presence", editors: editors(id) });

  return {
    publish,
    editors,
    has: (id: string) => rooms.has(id),

    /** Adds a browser to a roster's room. The function it returns takes it out again. */
    subscribe(id: string, subscriber: Subscriber): () => void {
      const room = rooms.get(id) ?? new Set();
      room.add(subscriber);
      rooms.set(id, room);
      announce(id);
      let gone = false;
      return () => {
        if (gone) return;
        gone = true;
        room.delete(subscriber);
        if (room.size === 0) rooms.delete(id);
        else announce(id);
      };
    },

    /** Marks the player an editor is dragging, so the others can see it. */
    setDragging(id: string, clientId: string, dragging: number | null): boolean {
      let changed = false;
      for (const subscriber of rooms.get(id) ?? []) {
        if (subscriber.clientId === clientId && subscriber.dragging !== dragging) {
          subscriber.dragging = dragging;
          changed = true;
        }
      }
      if (changed) announce(id);
      return changed;
    },

    /** Tells everyone on a roster's page that it is gone, and ends their streams. */
    close(id: string): void {
      const room = rooms.get(id);
      if (!room) return;
      rooms.delete(id);
      for (const subscriber of room) {
        subscriber.send({ type: "closed" });
        subscriber.close();
      }
    },
  };
}
export type RosterHub = ReturnType<typeof createRosterHub>;

/**
 * Allows `rate` actions a second per key, with bursts up to `burst`. Anyone with a roster's link
 * can edit it, so this keeps one browser from flooding the server.
 */
export function createRateLimit(rate: number, burst: number, now = () => Date.now()) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (key: string, cost = 1): boolean => {
    const time = now();
    const bucket = buckets.get(key) ?? { tokens: burst, at: time };
    bucket.tokens = Math.min(burst, bucket.tokens + ((time - bucket.at) / 1000) * rate);
    bucket.at = time;
    if (bucket.tokens < cost) {
      buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= cost;
    // A full bucket is the same as none, so idle keys don't pile up.
    if (bucket.tokens >= burst) buckets.delete(key);
    else buckets.set(key, bucket);
    return true;
  };
}

/**
 * Asks for a preview redraw at most once per `gap`, however many changes arrive. The first
 * change is sent at once, and the last one in a burst is always followed by a redraw.
 */
export function createCoalescer(gap: number, send: (id: string) => Promise<void>) {
  const state = new Map<string, { at: number; timer?: ReturnType<typeof setTimeout> }>();
  /** Resolves once a redraw sent at once is queued. A later one is queued by a timer. */
  return async (id: string): Promise<void> => {
    const entry = state.get(id);
    const now = Date.now();
    if (!entry || now - entry.at >= gap) {
      if (entry?.timer) clearTimeout(entry.timer);
      state.set(id, { at: now });
      await send(id);
      return;
    }
    if (entry.timer) return;
    entry.timer = setTimeout(
      () => {
        state.set(id, { at: Date.now() });
        void send(id);
      },
      gap - (now - entry.at),
    );
    entry.timer.unref?.();
  };
}
