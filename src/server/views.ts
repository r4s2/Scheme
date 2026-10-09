import { buildBracket, deadlineFor, matchStatus, playableMatches, resultOf, type Bracket, type Match, type MatchStatus } from "@/engine";
import type { Dispute, ExtensionRequest, Report, TournamentAgg } from "./model";

/** Derived, read-only views of a tournament for pages. */

export function bracketOf(agg: TournamentAgg): Bracket {
  return buildBracket(agg.state);
}

export function statusOf(agg: TournamentAgg, m: Match, now: Date): MatchStatus {
  return matchStatus(agg.state, m, {
    now,
    schedule: agg.schedule,
    live: agg.status === "live" && agg.schedule.waveDeadlines.length > 0,
    hasPendingReport: agg.reports.some((r) => r.matchId === m.id),
    hasOpenDispute: agg.disputes.some((d) => d.matchId === m.id && d.status === "open"),
  });
}

export interface DeskItems {
  disputes: { dispute: Dispute; match: Match; reports: Report[] }[];
  awaitingConfirm: { match: Match; report: Report }[];
  extensions: { request: ExtensionRequest; match: Match | undefined }[];
  overdue: { match: Match; hoursOver: number }[];
  count: number;
}

/** Everything that needs a decision from the host. */
export function deskItems(agg: TournamentAgg, now: Date): DeskItems {
  const b = bracketOf(agg);
  const byId = new Map(b.matches.map((m) => [m.id, m]));
  const disputes = agg.disputes
    .filter((d) => d.status === "open")
    .flatMap((d) => {
      const match = byId.get(d.matchId);
      return match ? [{ dispute: d, match, reports: agg.reports.filter((r) => r.matchId === d.matchId) }] : [];
    });
  const disputed = new Set(disputes.map((d) => d.match.id));
  const awaitingConfirm = agg.reports
    .filter((r) => !disputed.has(r.matchId))
    .flatMap((r) => {
      const match = byId.get(r.matchId);
      return match && !resultOf(agg.state, match) ? [{ match, report: r }] : [];
    });
  const extensions = agg.extensions.filter((x) => x.status === "pending").map((request) => ({ request, match: byId.get(request.matchId) }));
  const overdue =
    agg.status === "live"
      ? playableMatches(agg.state, b).flatMap((m) => {
          const s = statusOf(agg, m, now);
          return s.kind === "overdue" ? [{ match: m, hoursOver: s.hoursOver }] : [];
        })
      : [];
  return { disputes, awaitingConfirm, extensions, overdue, count: disputes.length + awaitingConfirm.length + extensions.length + overdue.length };
}

/** The match a team should look at now: its open match, else its latest result. */
export function currentMatchFor(agg: TournamentAgg, teamId: string): Match | null {
  const b = bracketOf(agg);
  const mine = b.matches.filter((m) => m.a === teamId || m.b === teamId);
  return mine.find((m) => m.a && m.b && !resultOf(agg.state, m)) ?? [...mine].filter((m) => resultOf(agg.state, m)).sort((x, y) => y.wave - x.wave)[0] ?? null;
}

export function deadlineOf(agg: TournamentAgg, m: Match): Date | null {
  return agg.schedule.waveDeadlines.length ? deadlineFor(agg.schedule, m) : null;
}
