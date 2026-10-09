import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toEngineState, type ResultRow, type TeamRow, type TournamentRow } from "./mapping";

export interface LoadedTournament {
  id: string;
  name: string;
  game: "val" | "mr" | "ow" | "lol";
  status: string;
  region: string;
  engine: ReturnType<typeof toEngineState>;
}

/**
 * Load one tournament and everything the engine needs to derive its bracket.
 * Runs as the signed-in user, so it only returns what row-level security allows.
 */
export async function loadTournament(supabase: SupabaseClient, id: string): Promise<LoadedTournament | null> {
  const { data: t, error } = await supabase
    .from("tournaments")
    .select("id, name, game, status, region, format, best_of, slots, wave_deadlines, deadline_overrides")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!t) return null;

  const [{ data: teams, error: teamErr }, { data: results, error: resErr }] = await Promise.all([
    supabase
      .from("tournament_teams")
      .select("id, name, captain_id, tournament_players(profile_id, role, rank_score, rank_source, checked_in_at, profiles(handle))")
      .eq("tournament_id", id),
    supabase.from("match_results").select("result_key, match_id, winner_team_id, w, l, source").eq("tournament_id", id),
  ]);
  if (teamErr) throw teamErr;
  if (resErr) throw resErr;

  return {
    id: t.id,
    name: t.name,
    game: t.game,
    status: t.status,
    region: t.region,
    engine: toEngineState(t as TournamentRow, (teams ?? []) as unknown as TeamRow[], (results ?? []) as ResultRow[]),
  };
}
