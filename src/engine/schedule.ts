import { resultOf } from "./bracket";
import type { Match, TournamentState } from "./types";

const HOUR = 3_600_000;

export interface Schedule {
  /** Deadline for each wave (round), as ISO timestamps. */
  waveDeadlines: string[];
  /** Per-match deadline overrides from extensions, as ISO timestamps. */
  overrides: Record<string, string>;
}

export const DEFAULTS = {
  /** A lone captain report confirms itself after this long. */
  autoConfirmHours: 12,
  /** Cash payouts release this long after the tournament closes. */
  disputeWindowHours: 24,
  /** Gap between waves when the schedule runs past its listed deadlines. */
  extraWaveHours: 24,
} as const;

/** Build wave deadlines: first deadline at start + matchWindow, then one per day. */
export function makeSchedule(startIso: string, matchWindowHours: number, waves: number): Schedule {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) throw new Error(`Invalid start time: ${startIso}`);
  const waveDeadlines = Array.from({ length: waves }, (_, i) => new Date(start + (matchWindowHours + i * 24) * HOUR).toISOString());
  return { waveDeadlines, overrides: {} };
}

export function deadlineFor(schedule: Schedule, match: Pick<Match, "id" | "wave">): Date {
  const o = schedule.overrides[match.id];
  if (o) return new Date(o);
  const list = schedule.waveDeadlines;
  if (list.length === 0) throw new Error("Schedule has no wave deadlines.");
  if (match.wave < list.length) return new Date(list[match.wave]);
  const last = Date.parse(list[list.length - 1]);
  return new Date(last + (match.wave - list.length + 1) * DEFAULTS.extraWaveHours * HOUR);
}

/** Move one match's deadline later. Returns a new schedule. */
export function extendDeadline(schedule: Schedule, match: Pick<Match, "id" | "wave">, hours: number): Schedule {
  if (hours <= 0) throw new Error("Extensions must add time.");
  const next = new Date(deadlineFor(schedule, match).getTime() + hours * HOUR).toISOString();
  return { ...schedule, overrides: { ...schedule.overrides, [match.id]: next } };
}

export type MatchStatus =
  | { kind: "final" }
  | { kind: "forfeit" }
  | { kind: "waiting" }
  | { kind: "scheduled" }
  | { kind: "disputed" }
  | { kind: "awaiting_confirm" }
  | { kind: "due"; hoursLeft: number }
  | { kind: "overdue"; hoursOver: number };

export interface StatusContext {
  now: Date;
  schedule: Schedule;
  /** Tournament has started (deadlines are counting). */
  live: boolean;
  hasPendingReport: boolean;
  hasOpenDispute: boolean;
}

export function matchStatus(state: TournamentState, match: Match, ctx: StatusContext): MatchStatus {
  const r = resultOf(state, match);
  if (r) return { kind: r.by === "forfeit" ? "forfeit" : "final" };
  if (!match.a || !match.b) return { kind: "waiting" };
  if (!ctx.live) return { kind: "scheduled" };
  if (ctx.hasOpenDispute) return { kind: "disputed" };
  if (ctx.hasPendingReport) return { kind: "awaiting_confirm" };
  const diffH = (deadlineFor(ctx.schedule, match).getTime() - ctx.now.getTime()) / HOUR;
  return diffH < 0 ? { kind: "overdue", hoursOver: Math.ceil(-diffH) } : { kind: "due", hoursLeft: Math.floor(diffH) };
}

/** When a single unanswered report becomes the result. */
export function autoConfirmAt(reportedAtIso: string, hours: number = DEFAULTS.autoConfirmHours): Date {
  return new Date(Date.parse(reportedAtIso) + hours * HOUR);
}

/** When cash payouts may be released after closing. */
export function payoutReleaseAt(closedAtIso: string, hours: number = DEFAULTS.disputeWindowHours): Date {
  return new Date(Date.parse(closedAtIso) + hours * HOUR);
}
