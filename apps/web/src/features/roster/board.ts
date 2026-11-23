/** The player's place on the board. Zero is the unassigned pool. */
export const UNASSIGNED = 0;

export interface Placement {
  assignments: Record<string, number>;
  squadLeaders: Record<string, number>;
}

export const squadOf = ({ assignments }: Placement, player: number): number =>
  assignments[String(player)] ?? UNASSIGNED;

export const squadSize = ({ assignments }: Placement, squad: number): number =>
  Object.values(assignments).filter((assigned) => assigned === squad).length;

/**
 * Moves a player. A leader who leaves stops leading.
 */
export function movePlayer(placement: Placement, player: number, squad: number): Placement {
  const from = squadOf(placement, player);
  if (from === squad) return placement;

  const assignments = { ...placement.assignments };
  if (squad === UNASSIGNED) delete assignments[String(player)];
  else assignments[String(player)] = squad;

  const squadLeaders = { ...placement.squadLeaders };
  if (squadLeaders[String(from)] === player) delete squadLeaders[String(from)];
  return { assignments, squadLeaders };
}

/** Makes a player their squad's leader, replacing the last one. On the leader, it clears it. */
export function toggleLeader(placement: Placement, player: number): Placement {
  const squad = squadOf(placement, player);
  if (squad === UNASSIGNED) return placement;
  const squadLeaders = { ...placement.squadLeaders };
  if (squadLeaders[String(squad)] === player) delete squadLeaders[String(squad)];
  else squadLeaders[String(squad)] = player;
  return { ...placement, squadLeaders };
}

/** A squad's players, in sign-up order with the leader first. */
export function membersOf(placement: Placement, squad: number, playerCount: number): number[] {
  const leader = placement.squadLeaders[String(squad)];
  const members = Array.from({ length: playerCount }, (_, player) => player).filter(
    (player) => squadOf(placement, player) === squad,
  );
  if (squad === UNASSIGNED || leader === undefined || !members.includes(leader)) return members;
  return [leader, ...members.filter((player) => player !== leader)];
}

/**
 * Takes a squad off the board. Its players go back to the pool, and the squads after it move up a
 * number, because a squad's number is its place in the list.
 */
export function removeSquad(placement: Placement, squad: number): Placement {
  const renumber = (number: number) => (number > squad ? number - 1 : number);
  return {
    assignments: Object.fromEntries(
      Object.entries(placement.assignments)
        .filter(([, assigned]) => assigned !== squad)
        .map(([player, assigned]) => [player, renumber(assigned)]),
    ),
    squadLeaders: Object.fromEntries(
      Object.entries(placement.squadLeaders)
        .filter(([number]) => Number(number) !== squad)
        .map(([number, player]) => [String(renumber(Number(number))), player]),
    ),
  };
}
