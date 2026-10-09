import { buildBracket, canReopen, findMatch, resultOf } from "./bracket";
import type { Match, MatchResult, ResultSource, TournamentState } from "./types";

export interface ScoreReport {
  team: string;
  winner: string;
  w: number;
  l: number;
}

/** Valid series scores for a best-of, e.g. Bo3 → [[2,0],[2,1]]. */
export function scoreOptions(bestOf: number): [number, number][] {
  const need = Math.ceil(bestOf / 2);
  return Array.from({ length: need }, (_, l) => [need, l] as [number, number]);
}

export function isValidScore(bestOf: number, w: number, l: number): boolean {
  return scoreOptions(bestOf).some(([a, b]) => a === w && b === l);
}

export class EngineError extends Error {}

function requireMatch(state: TournamentState, matchId: string): { match: Match; bracket: ReturnType<typeof buildBracket> } {
  const bracket = buildBracket(state);
  const match = findMatch(bracket, matchId);
  if (!match) throw new EngineError(`Match ${matchId} does not exist.`);
  if (!match.a || !match.b || !match.resultKey) throw new EngineError(`Match ${matchId} doesn't have both teams yet.`);
  return { match, bracket };
}

/**
 * Record a result. Returns new state; never mutates the input.
 * Forfeits are stored as a full sweep so standings math stays simple.
 */
export function recordResult(
  state: TournamentState,
  matchId: string,
  winner: string,
  w: number,
  l: number,
  by: ResultSource,
): { state: TournamentState; championDecided: string | null } {
  const { match, bracket } = requireMatch(state, matchId);
  if (winner !== match.a && winner !== match.b) throw new EngineError(`${winner} isn't in ${matchId}.`);
  const existing = resultOf(state, match);
  if (existing && !canReopen(state, bracket, match)) {
    throw new EngineError(`${matchId} can't change because a later match already depends on it.`);
  }
  const score: [number, number] = by === "forfeit" ? [Math.ceil(state.bestOf / 2), 0] : [w, l];
  if (!isValidScore(state.bestOf, score[0], score[1])) throw new EngineError(`${w}–${l} isn't a valid Bo${state.bestOf} score.`);
  const result: MatchResult = { winner, w: score[0], l: score[1], by, matchId };
  const next: TournamentState = { ...state, results: { ...state.results, [match.resultKey as string]: result } };
  const wasComplete = bracket.complete;
  const after = buildBracket(next);
  return { state: next, championDecided: !wasComplete && after.complete ? after.champion : null };
}

/** Clear a result so the match can be replayed or re-entered. */
export function reopenResult(state: TournamentState, matchId: string): TournamentState {
  const { match, bracket } = requireMatch(state, matchId);
  if (!resultOf(state, match)) throw new EngineError(`${matchId} has no result to reopen.`);
  if (!canReopen(state, bracket, match)) throw new EngineError(`${matchId} can't reopen because a later match depends on it.`);
  const results = { ...state.results };
  delete results[match.resultKey as string];
  return { ...state, results };
}

export type ReportOutcome =
  | { kind: "waiting" }
  | { kind: "confirmed"; result: { winner: string; w: number; l: number } }
  | { kind: "disputed"; reports: [ScoreReport, ScoreReport] };

/**
 * Compare captain reports for one match. Two matching reports confirm the
 * result; two different reports open a dispute; one report waits.
 */
export function evaluateReports(match: Pick<Match, "a" | "b">, reports: ScoreReport[]): ReportOutcome {
  const ra = reports.find((r) => r.team === match.a);
  const rb = reports.find((r) => r.team === match.b);
  if (!ra || !rb) return { kind: "waiting" };
  if (ra.winner === rb.winner && ra.w === rb.w && ra.l === rb.l) {
    return { kind: "confirmed", result: { winner: ra.winner, w: ra.w, l: ra.l } };
  }
  return { kind: "disputed", reports: [ra, rb] };
}
