import { useCallback, useEffect, useRef, useState } from "react";
import { applyOp, type BoardState, type RosterOp } from "@scrimbot/core";

export type { BoardState, RosterOp };

export interface Editor {
  clientId: string;
  name: string;
  dragging: number | null;
}

/** What the page loads besides the board, plus the board and its revision. */
export interface Loaded extends BoardState {
  revision: number;
  status: "draft" | "posted" | "editing";
  event: { responses: { accepted: unknown[] } };
}

export type SaveState = "idle" | "saving" | "saved" | "failed";

interface Pending {
  id: string;
  op: RosterOp;
  sent: boolean;
  done: { resolve: () => void; reject: (error: Error) => void };
}

/** While the live stream is down, the page asks for the roster this often. */
const POLL_MS = 5000;
/** Changes made within this long of each other go in one request. */
const BATCH_MS = 40;
/** The server takes at most this many changes in one request. More wait for the next one. */
const MAX_BATCH = 20;
const RETRY_MS = 3000;
const NAME_KEY = "roster-editor-name";

const api = (token: string, path = "") => `/api/roster/${encodeURIComponent(token)}${path}`;
const randomId = () => Math.random().toString(36).slice(2, 12);

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

const boardOf = (data: Loaded): BoardState => ({
  assignments: data.assignments,
  squadLeaders: data.squadLeaders,
  squadNames: data.squadNames,
  showBanner: data.showBanner,
  showBench: data.showBench,
  embedStyle: data.embedStyle,
  answerOptions: data.answerOptions,
});

/**
 * Keeps one roster's board in step with the server and everyone else on the link. The server's
 * copy is the true one. This page shows it with its own unconfirmed changes on top, using the
 * same change function the server runs, so a change shows at once and then simply stays.
 */
export function useRosterSync<T extends Loaded>(token: string) {
  const [data, setData] = useState<T | "missing" | "failed">();
  const [board, setBoard] = useState<BoardState>();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [editors, setEditors] = useState<Editor[]>([]);
  const [live, setLive] = useState(false);
  const [name, setNameState] = useState(storedName);

  const clientId = useRef(randomId()).current;
  const confirmed = useRef<{ board: BoardState; revision: number; players: number }>(undefined);
  const pending = useRef<Pending[]>([]);
  const sending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const status = useRef<Loaded["status"]>(undefined);

  /** Shows the confirmed board with this page's waiting changes applied. */
  const redraw = useCallback(() => {
    const base = confirmed.current;
    if (!base) return;
    setBoard(pending.current.reduce((s, p) => applyOp(s, p.op, base.players), base.board));
  }, []);

  const load = useCallback(async () => {
    const response = await fetch(api(token)).catch(() => undefined);
    if (!response) return;
    if (response.status === 404) return setData("missing");
    if (!response.ok) return setData((current) => current ?? "failed");
    const body = (await response.json()) as T;
    status.current = body.status;
    // A slow answer must not take the board back to an older revision.
    if (!confirmed.current || body.revision >= confirmed.current.revision) {
      confirmed.current = {
        board: boardOf(body),
        revision: body.revision,
        players: body.event.responses.accepted.length,
      };
    }
    setData(body);
    redraw();
  }, [token, redraw]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    const batch = pending.current.filter((p) => !p.sent).slice(0, MAX_BATCH);
    if (batch.length === 0) return;
    sending.current = true;
    for (const p of batch) p.sent = true;
    setSaveState("saving");
    try {
      const response = await fetch(api(token, "/ops"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, ops: batch.map(({ id, op }) => ({ id, op })) }),
      });
      if (response.ok) {
        const body = (await response.json()) as { revision: number; state: BoardState };
        const base = confirmed.current!;
        if (body.revision > base.revision) {
          confirmed.current = { ...base, board: body.state, revision: body.revision };
        }
        settle(batch);
        setError("");
      } else if (response.status === 400 || response.status === 404 || response.status === 409) {
        // The server will never take these changes, so they are dropped and the board reloaded.
        const message =
          ((await response.json().catch(() => ({}))) as { error?: string }).error ??
          "Change refused";
        settle(batch, new Error(message));
        setError(message);
        await load();
      } else {
        throw new Error(String(response.status));
      }
    } catch {
      // Offline, or the server is busy. The changes stay and are sent again.
      for (const p of batch) p.sent = false;
      setSaveState("failed");
      sending.current = false;
      timer.current = setTimeout(() => void flush(), RETRY_MS);
      return;
    }
    sending.current = false;
    redraw();
    if (pending.current.some((p) => !p.sent)) void flush();
    else if (pending.current.length === 0) setSaveState("saved");
  }, [token, clientId, load, redraw]);

  function settle(done: Pending[], failure?: Error) {
    const ids = new Set(done.map((p) => p.id));
    pending.current = pending.current.filter((p) => !ids.has(p.id));
    for (const p of done) {
      if (failure) p.done.reject(failure);
      else p.done.resolve();
    }
  }

  /** Makes a change here at once, and sends it. Resolves once the server has it. */
  const change = useCallback(
    (op: RosterOp): Promise<void> => {
      if (!confirmed.current || status.current === "posted") return Promise.resolve();
      return new Promise((resolve, reject) => {
        pending.current.push({ id: randomId(), op, sent: false, done: { resolve, reject } });
        redraw();
        setSaveState("saving");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), BATCH_MS);
      });
    },
    [flush, redraw],
  );

  const retry = useCallback(() => {
    clearTimeout(timer.current);
    void flush();
  }, [flush]);

  useEffect(() => {
    void load().catch(() => setData("failed"));
  }, [load]);

  // Everyone else's changes, as the server applies them.
  const loaded = data !== undefined && typeof data === "object";
  const posted = loaded && data.status === "posted";
  useEffect(() => {
    if (!loaded || posted) return;
    const query = new URLSearchParams({ clientId, name });
    const source = new EventSource(api(token, `/events?${query.toString()}`));
    const on = <E>(type: string, handle: (event: E) => void) =>
      source.addEventListener(type, (message) =>
        handle(JSON.parse((message as MessageEvent<string>).data) as E),
      );

    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    on<{ revision: number }>("hello", ({ revision }) => {
      if (revision !== confirmed.current?.revision) void load();
    });
    on<{ revision: number; clientId: string; opId: string; op: RosterOp }>("op", (event) => {
      const base = confirmed.current;
      if (!base || event.revision <= base.revision) return;
      // A gap means a missed change, so the whole roster is loaded again.
      if (event.revision !== base.revision + 1) return void load();
      confirmed.current = {
        ...base,
        board: applyOp(base.board, event.op, base.players),
        revision: event.revision,
      };
      if (event.clientId === clientId) {
        settle(pending.current.filter((p) => p.id === event.opId && p.sent));
      }
      redraw();
    });
    on("reset", () => void load());
    on("closed", () => {
      source.close();
      setLive(false);
      void load();
    });
    on<{ editors: Editor[] }>("presence", ({ editors: all }) => setEditors(all));
    return () => {
      source.close();
      setLive(false);
      setEditors([]);
    };
  }, [loaded, posted, token, clientId, name, load, redraw]);

  // Without the live stream, look for changes now and then instead.
  useEffect(() => {
    if (!loaded || posted || live) return;
    const poll = setInterval(() => {
      if (!sending.current) void load();
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [loaded, posted, live, load]);

  const setName = useCallback((next: string) => {
    const trimmed = next.trim().slice(0, 32);
    try {
      localStorage.setItem(NAME_KEY, trimmed);
    } catch {
      // Remembering the name is a convenience only.
    }
    setNameState(trimmed);
  }, []);

  /** Tells the others which player this page is dragging. Best effort. */
  const setDragging = useCallback(
    (player: number | null) => {
      void fetch(api(token, "/presence"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, dragging: player }),
      }).catch(() => undefined);
    },
    [token, clientId],
  );

  return {
    data,
    board,
    saveState,
    error,
    live,
    editors: editors.filter((e) => e.clientId !== clientId),
    name,
    setName,
    change,
    retry,
    setDragging,
    reload: load,
  };
}
