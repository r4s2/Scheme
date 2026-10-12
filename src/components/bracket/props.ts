import type { TournamentAgg } from "@/server/model";
import type { BracketBoardProps } from "./BracketBoard";

/** Everything the bracket board needs about a stored tournament, as plain data. */
export function boardProps(
  agg: TournamentAgg,
  now: Date,
  opts: { mine?: string | null; wins?: Record<string, number>; host?: BracketBoardProps["host"] } = {},
): BracketBoardProps {
  return {
    state: agg.state,
    game: agg.game,
    tid: agg.id,
    version: agg.version,
    now: now.toISOString(),
    schedule: agg.schedule,
    live: agg.status === "live",
    pendingReports: [...new Set(agg.reports.map((r) => r.matchId))],
    openDisputes: agg.disputes.filter((d) => d.status === "open").map((d) => d.matchId),
    mine: opts.mine ?? null,
    wins: opts.wins ?? {},
    phase: agg.status === "registration" ? "registration" : agg.status === "checkin" ? "checkin" : "play",
    host: opts.host,
  };
}
