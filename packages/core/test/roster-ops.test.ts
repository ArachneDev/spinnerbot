import { describe, expect, it } from "vitest";
import {
  applyOp,
  DEFAULT_ANSWER_OPTIONS,
  DEFAULT_SQUAD_NAMES,
  InvalidOpError,
  opServerEmojiIds,
  rosterOpSchema,
  type BoardState,
  type RosterOp,
} from "../src/index.js";

const PLAYERS = 6;
const start = (): BoardState => ({
  assignments: {},
  squadLeaders: {},
  squadNames: DEFAULT_SQUAD_NAMES.slice(0, 3),
  showBanner: false,
  showBench: true,
  embedStyle: {},
  answerOptions: DEFAULT_ANSWER_OPTIONS,
});
const run = (ops: RosterOp[], state = start()) =>
  ops.reduce((s, op) => applyOp(s, op, PLAYERS), state);

describe("applyOp", () => {
  it("moves players, and a leader who leaves stops leading", () => {
    const state = run([
      { type: "move", player: 0, squad: 1 },
      { type: "leader", player: 0, lead: true },
      { type: "move", player: 0, squad: 2 },
    ]);
    expect(state.assignments).toEqual({ "0": 2 });
    expect(state.squadLeaders).toEqual({});
    expect(run([{ type: "move", player: 0, squad: 0 }], state).assignments).toEqual({});
  });

  it("ignores changes to things that no longer exist, so the later change wins", () => {
    const state = run([
      { type: "move", player: 9, squad: 1 },
      { type: "move", player: 0, squad: 4 },
      { type: "rename", squad: 5, name: "X" },
      { type: "leader", player: 1, lead: true },
    ]);
    expect(state).toEqual(start());
  });

  it("removes a squad, renumbering the ones after it with their players, leaders and emoji", () => {
    const state = run([
      { type: "move", player: 0, squad: 1 },
      { type: "move", player: 1, squad: 3 },
      { type: "leader", player: 1, lead: true },
      { type: "squadEmoji", squad: 3, emoji: { name: "🔥" } },
      { type: "removeSquad", squad: 2 },
    ]);
    expect(state.squadNames).toEqual([DEFAULT_SQUAD_NAMES[0], DEFAULT_SQUAD_NAMES[2]]);
    expect(state.assignments).toEqual({ "0": 1, "1": 2 });
    expect(state.squadLeaders).toEqual({ "2": 1 });
    expect(state.embedStyle.squadEmojis).toEqual([null, { name: "🔥" }]);
  });

  it("keeps at least one squad", () => {
    const one = { ...start(), squadNames: ["Solo"] };
    expect(run([{ type: "removeSquad", squad: 1 }], one).squadNames).toEqual(["Solo"]);
  });

  it("sets and clears one style field, and refuses a value of the wrong kind", () => {
    const state = run([{ type: "style", field: "colour", value: "#00cdde" }]);
    expect(state.embedStyle).toEqual({ colour: "#00cdde" });
    expect(run([{ type: "style", field: "colour", value: null }], state).embedStyle).toEqual({});
    expect(() => run([{ type: "style", field: "colour", value: "red" }])).toThrow(InvalidOpError);
  });

  it("names the server emoji a change would use", () => {
    const wolf = { id: "123456789012345678", name: "wolf" };
    expect(opServerEmojiIds({ type: "style", field: "leaderEmoji", value: wolf })).toEqual([
      wolf.id,
    ]);
    expect(opServerEmojiIds({ type: "squadEmoji", squad: 1, emoji: { name: "🔥" } })).toEqual([]);
  });

  it("refuses malformed changes before they are applied", () => {
    expect(rosterOpSchema.safeParse({ type: "move", player: -1, squad: 1 }).success).toBe(false);
    expect(rosterOpSchema.safeParse({ type: "rename", squad: 1, name: " " }).success).toBe(false);
    expect(rosterOpSchema.safeParse({ type: "delete-everything" }).success).toBe(false);
  });
});

/** A small seeded random source, so a failure can be replayed. */
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

function randomOp(next: () => number, state: BoardState): RosterOp {
  const pick = (n: number) => Math.floor(next() * n);
  const squad = 1 + pick(state.squadNames.length + 1);
  switch (pick(7)) {
    case 0:
    case 1:
      return { type: "move", player: pick(PLAYERS), squad: pick(state.squadNames.length + 1) };
    case 2:
      return { type: "leader", player: pick(PLAYERS), lead: next() < 0.7 };
    case 3:
      return { type: "rename", squad, name: `N${pick(100)}` };
    case 4:
      return next() < 0.5
        ? { type: "addSquad", name: `S${pick(100)}` }
        : { type: "removeSquad", squad };
    case 5:
      return { type: "squadEmoji", squad, emoji: next() < 0.5 ? null : { name: "🔥" } };
    default:
      return { type: "toggle", field: "showBench", value: next() < 0.5 };
  }
}

describe("several editors at once", () => {
  it("every browser ends with the server's board, whatever order changes arrive in", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const next = random(seed);
      let server = start();
      let revision = 0;
      // Each browser shows the confirmed board with its own unconfirmed changes on top.
      const clients = Array.from({ length: 3 }, () => ({
        confirmed: start(),
        pending: [] as { id: number; op: RosterOp }[],
        inbox: [] as { client: number; id: number; op: RosterOp }[],
      }));
      const outbox: { client: number; id: number; op: RosterOp }[] = [];
      const view = (c: (typeof clients)[number]) =>
        c.pending.reduce((s, p) => applyOp(s, p.op, PLAYERS), c.confirmed);
      let opId = 0;

      for (let step = 0; step < 60; step++) {
        const roll = next();
        const index = Math.floor(next() * clients.length);
        const client = clients[index]!;
        if (roll < 0.4) {
          // Someone makes a change on their screen and sends it.
          const op = randomOp(next, view(client));
          const id = ++opId;
          client.pending.push({ id, op });
          outbox.push({ client: index, id, op });
        } else if (roll < 0.7 && outbox.length > 0) {
          // The server receives some sent change, in whatever order the network delivers.
          const [sent] = outbox.splice(Math.floor(next() * outbox.length), 1);
          server = applyOp(server, sent!.op, PLAYERS);
          revision++;
          for (const c of clients) c.inbox.push(sent!);
        } else if (client.inbox.length > 0) {
          // A browser receives the next update, always in the server's order.
          const event = client.inbox.shift()!;
          client.confirmed = applyOp(client.confirmed, event.op, PLAYERS);
          if (event.client === index)
            client.pending = client.pending.filter((p) => p.id !== event.id);
        }
      }
      // Deliver everything still on its way.
      for (const sent of outbox.splice(0)) {
        server = applyOp(server, sent.op, PLAYERS);
        revision++;
        for (const c of clients) c.inbox.push(sent);
      }
      clients.forEach((client, index) => {
        for (const event of client.inbox.splice(0)) {
          client.confirmed = applyOp(client.confirmed, event.op, PLAYERS);
          if (event.client === index)
            client.pending = client.pending.filter((p) => p.id !== event.id);
        }
        expect(client.pending, `seed ${seed}`).toEqual([]);
        expect(view(client), `seed ${seed}`).toEqual(server);
      });
      expect(revision).toBe(opId);
    }
  });
});
