import { GAMES, type GameId } from "@/engine";
import type { TournamentAgg } from "./model";
import type { Person, TournamentSummary, Win } from "./store/types";

/** Library card data for one tournament. Used by the in-memory store; Postgres computes the same in SQL. */
export function summarize(t: TournamentAgg, hostKarma: number): TournamentSummary {
  const teams = Object.values(t.state.teams);
  const seated = teams.reduce((n, team) => n + team.players.length, 0);
  return {
    id: t.id,
    name: t.name,
    game: t.game,
    status: t.status,
    host: t.host,
    hostKarma,
    format: t.state.format,
    signupType: t.signupType,
    region: t.region,
    entryFeeCents: t.entryFeeCents,
    teamCount: t.teamCount,
    teamSize: teams[0]?.players.length || GAMES[t.game].roles.length,
    registered: t.signupType === "solo" ? seated + t.pool.length : teams.length,
    startsAt: t.startsAt,
    rankMin: t.rankMin,
    rankMax: t.rankMax,
    winners: t.status === "complete" && t.closure ? (t.closure.places[0] ?? []).map((id) => t.state.teams[id]?.name ?? id) : [],
    players: [...new Set([...teams.flatMap((team) => team.players.map((p) => p.handle)), ...t.subs.map((p) => p.handle), ...t.pool.map((p) => p.handle)])],
  };
}

export function winsOf(t: TournamentAgg): Win[] {
  if (t.status !== "complete" || !t.closure) return [];
  return (t.closure.places[0] ?? []).flatMap((id) => {
    const team = t.state.teams[id];
    return team ? [{ tournamentId: t.id, game: t.game, team: team.name, players: team.players.map((p) => p.handle), at: t.closure!.at }] : [];
  });
}

export function peopleOf(all: TournamentAgg[]): Person[] {
  const map = new Map<string, Person>();
  const get = (handle: string) => {
    let p = map.get(handle);
    if (!p) map.set(handle, (p = { handle, host: false, teams: [] }));
    return p;
  };
  for (const t of all) {
    if (t.status === "complete" || t.status === "cancelled") continue;
    get(t.host).host = true;
    for (const team of Object.values(t.state.teams)) {
      for (const pl of team.players) {
        const p = get(pl.handle);
        if (!p.teams.some((x) => x.name === team.name)) p.teams.push({ name: team.name, captain: team.captain === pl.handle });
      }
    }
  }
  return sortPeople([...map.values()]);
}

/** Hosts first, then captains, then everyone else, alphabetically. */
export function sortPeople(people: Person[]): Person[] {
  const rank = (p: Person) => (p.host ? 0 : p.teams.some((t) => t.captain) ? 1 : 2);
  for (const p of people) p.teams.sort((a, b) => Number(b.captain) - Number(a.captain));
  return people.sort((a, b) => rank(a) - rank(b) || a.handle.localeCompare(b.handle));
}

export interface BoardRow {
  name: string;
  wins: number;
  /** Game name for teams; games played for players. */
  detail: string;
}

export interface Board {
  key: string;
  label: string;
  /** "team" or "player": what the rows are. */
  kind: "team" | "player";
  rows: BoardRow[];
}

/**
 * Leaderboards ranked by tournaments won: all teams, all players, then one
 * board per game that has at least one closed tournament. Teams are matched
 * by name within a game.
 */
export function buildBoards(wins: Win[]): Board[] {
  const teamWins = new Map<string, { name: string; game: GameId; wins: number }>();
  const playerWins = new Map<string, { wins: number; games: Set<GameId> }>();
  for (const w of wins) {
    const key = `${w.game}:${w.team.toLowerCase()}`;
    const t = teamWins.get(key) ?? { name: w.team, game: w.game, wins: 0 };
    t.wins++;
    teamWins.set(key, t);
    for (const h of w.players) {
      const p = playerWins.get(h) ?? { wins: 0, games: new Set<GameId>() };
      p.wins++;
      p.games.add(w.game);
      playerWins.set(h, p);
    }
  }
  const order = (a: BoardRow, b: BoardRow) => b.wins - a.wins || a.name.localeCompare(b.name);
  const teams = [...teamWins.values()];
  const boards: Board[] = [
    { key: "teams", label: "Teams", kind: "team", rows: teams.map((t) => ({ name: t.name, wins: t.wins, detail: GAMES[t.game].name })).sort(order) },
    {
      key: "players",
      label: "Players",
      kind: "player",
      rows: [...playerWins].map(([name, p]) => ({ name, wins: p.wins, detail: [...p.games].map((g) => GAMES[g].name).join(" · ") })).sort(order),
    },
  ];
  for (const g of Object.keys(GAMES) as GameId[]) {
    const rows = teams.filter((t) => t.game === g).map((t) => ({ name: t.name, wins: t.wins, detail: "Team" }));
    if (rows.length) boards.push({ key: g, label: GAMES[g].name, kind: "team", rows: rows.sort(order) });
  }
  return boards;
}
