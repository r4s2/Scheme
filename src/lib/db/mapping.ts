import type { FormatId, MatchResult, ResultSource, Team, TournamentState } from "@/engine";
import type { Schedule } from "@/engine";

/** Row shapes as selected from Supabase (see loadTournament). */
export interface TournamentRow {
  id: string;
  format: FormatId;
  best_of: number;
  slots: string[];
  wave_deadlines: string[];
  deadline_overrides: Record<string, string> | null;
}

export interface TeamRow {
  id: string;
  name: string;
  captain_id: string;
  tournament_players: {
    profile_id: string;
    role: string;
    rank_score: number;
    rank_source: "api" | "self";
    checked_in_at: string | null;
    profiles: { handle: string } | null;
  }[];
}

export interface ResultRow {
  result_key: string;
  match_id: string;
  winner_team_id: string;
  w: number;
  l: number;
  source: ResultSource;
}

/** Turn database rows into the engine's TournamentState and Schedule. */
export function toEngineState(t: TournamentRow, teams: TeamRow[], results: ResultRow[]): { state: TournamentState; schedule: Schedule } {
  if (t.best_of !== 1 && t.best_of !== 3 && t.best_of !== 5) throw new Error(`Unsupported best_of ${t.best_of}`);
  const teamMap: Record<string, Team> = {};
  for (const row of teams) {
    const captain = row.tournament_players.find((p) => p.profile_id === row.captain_id);
    teamMap[row.id] = {
      id: row.id,
      name: row.name,
      captain: captain?.profiles?.handle ?? "",
      players: row.tournament_players.map((p) => ({
        handle: p.profiles?.handle ?? "unknown",
        score: p.rank_score,
        role: p.role,
        verified: p.rank_source,
        checkedIn: p.checked_in_at !== null,
      })),
    };
  }
  const missing = t.slots.filter((id) => !teamMap[id]);
  if (missing.length) throw new Error(`Slots reference unknown teams: ${missing.join(", ")}`);
  const resultMap: Record<string, MatchResult> = {};
  for (const r of results) {
    resultMap[r.result_key] = { winner: r.winner_team_id, w: r.w, l: r.l, by: r.source, matchId: r.match_id };
  }
  return {
    state: { format: t.format, bestOf: t.best_of, slots: t.slots, teams: teamMap, results: resultMap },
    schedule: { waveDeadlines: t.wave_deadlines, overrides: t.deadline_overrides ?? {} },
  };
}
