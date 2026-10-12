import { averageScore, GAMES, rankShortName, type GameId, type Team, type TournamentState } from "@/engine";

/** What the hover card shows for one team. */
export interface HoverTeam {
  name: string;
  captain: string;
  avgRank: string;
  karma: number | null;
  wins: number;
  gameShort: string;
  stateLabel: string;
  stateTone: "good" | "warn" | "info";
  /** Starters, then subs. */
  players: { handle: string; role: string; rank: string; verified: "api" | "self"; checkedIn: boolean; sub: boolean; answer?: "pending" | "declined" }[];
}

export type Phase = "registration" | "checkin" | "play";

export function hoverTeam(t: Team, game: GameId, wins: number, phase: Phase = "play"): HoverTeam {
  const karma = t.players.filter((p) => p.karma != null);
  const allIn = t.players.every((p) => p.checkedIn);
  return {
    name: t.name,
    captain: t.captain,
    avgRank: rankShortName(game, averageScore(t)),
    karma: karma.length ? Math.round(karma.reduce((s, p) => s + (p.karma ?? 0), 0) / karma.length) : null,
    wins,
    gameShort: GAMES[game].name.split(" ")[0],
    stateLabel: phase === "registration" ? "Registered" : allIn ? "Checked in" : "Not all checked in",
    stateTone: phase === "registration" ? "info" : allIn ? "good" : "warn",
    players: [...t.players.map((p) => [p, false] as const), ...(t.bench ?? []).map((p) => [p, true] as const)].map(([p, sub]) => ({
      handle: p.handle,
      role: p.role,
      rank: rankShortName(game, p.score),
      verified: p.verified,
      checkedIn: p.checkedIn,
      sub,
      ...(p.confirmation ? { answer: p.confirmation } : {}),
    })),
  };
}

/** Hover card data for every team in a tournament. `wins` is keyed by lowercased team name. */
export function hoverTeams(state: TournamentState, game: GameId, wins: Record<string, number> = {}, phase: Phase = "play"): Record<string, HoverTeam> {
  const out: Record<string, HoverTeam> = {};
  for (const t of Object.values(state.teams)) out[t.id] = hoverTeam(t, game, wins[t.name.toLowerCase()] ?? 0, phase);
  return out;
}
