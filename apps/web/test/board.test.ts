import { describe, expect, it } from "vitest";
import {
  membersOf,
  movePlayer,
  removeSquad,
  squadSize,
  toggleLeader,
  UNASSIGNED,
} from "../src/features/roster/board.js";

const placement = {
  assignments: { "0": 1, "1": 1, "2": 2 },
  squadLeaders: { "1": 1 },
};

describe("roster board", () => {
  it("moves a player between squads and to the pool", () => {
    expect(movePlayer(placement, 0, 2).assignments).toEqual({ "0": 2, "1": 1, "2": 2 });
    expect(movePlayer(placement, 0, UNASSIGNED).assignments).toEqual({ "1": 1, "2": 2 });
  });

  it("clears the leader when the leader leaves, but not otherwise", () => {
    expect(movePlayer(placement, 1, 2).squadLeaders).toEqual({});
    expect(movePlayer(placement, 0, 2).squadLeaders).toEqual({ "1": 1 });
  });

  it("has no limit on a squad's size, and a move within a squad changes nothing", () => {
    const large = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i), 1]));
    const next = movePlayer({ assignments: large, squadLeaders: {} }, 30, 1);
    expect(squadSize(next, 1)).toBe(31);
    expect(movePlayer(placement, 0, 1)).toBe(placement);
  });

  it("gives a squad one leader, and clears on a second press", () => {
    expect(toggleLeader(placement, 0).squadLeaders).toEqual({ "1": 0 });
    expect(toggleLeader(placement, 1).squadLeaders).toEqual({});
    expect(toggleLeader(placement, 2).squadLeaders).toEqual({ "1": 1, "2": 2 });
  });

  it("does not make an unassigned player a leader", () => {
    expect(toggleLeader(placement, 5)).toBe(placement);
  });

  it("lists the leader first, then sign-up order", () => {
    expect(membersOf(placement, 1, 4)).toEqual([1, 0]);
    expect(membersOf(placement, UNASSIGNED, 4)).toEqual([3]);
  });

  it("returns a removed squad's players to the pool, and moves later squads up", () => {
    const next = removeSquad(
      { assignments: { "0": 1, "1": 2, "2": 3 }, squadLeaders: { "1": 0, "3": 2 } },
      1,
    );
    expect(next.assignments).toEqual({ "1": 1, "2": 2 });
    expect(next.squadLeaders).toEqual({ "2": 2 });
  });
});
