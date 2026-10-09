import { GAMES } from "../games";
import { seededRandom } from "../seeding";
import type { FormatId, GameId, Player, Team, TournamentState } from "../types";

/** Teams named T1..Tn whose average rank descends with the number (T1 strongest). */
export function makeTeams(n: number, game: GameId = "val"): Record<string, Team> {
  const teams: Record<string, Team> = {};
  for (let i = 1; i <= n; i++) {
    const id = `T${i}`;
    const players: Player[] = GAMES[game].roles.map((role, j) => ({
      handle: `${id.toLowerCase()}p${j}`,
      score: 20 - i,
      role,
      verified: "api",
      checkedIn: true,
    }));
    teams[id] = { id, name: `Team ${i}`, captain: players[0].handle, players };
  }
  return teams;
}

export function makeState(n: number, format: FormatId = "single", bestOf: 1 | 3 | 5 = 3): TournamentState {
  const teams = makeTeams(n);
  return { format, bestOf, slots: Object.keys(teams), teams, results: {} };
}

/** A random solo pool with every role represented `perRole` times. */
export function makePool(game: GameId, teams: number, seed = 1, lo = 6, hi = 20): Player[] {
  const rand = seededRandom(seed);
  const out: Player[] = [];
  let k = 0;
  for (let t = 0; t < teams; t++) {
    for (const role of GAMES[game].roles) {
      out.push({ handle: `p${k++}`, score: Math.round(lo + rand() * (hi - lo)), role, verified: "api", checkedIn: true });
    }
  }
  return out;
}
