/**
 * Core types for the Scheme tournament engine.
 *
 * The engine is pure: it takes plain data (teams, slots, results) and returns
 * derived structures (matches, standings, payouts). It never touches the
 * database, the network, or the clock unless a `now` is passed in. That keeps
 * it easy to test and safe to run on both the server and the client.
 */

export type GameId = "val" | "mr" | "ow" | "lol";

export type FormatId = "single" | "double" | "rr" | "swiss" | "groups";

export type RankSource = "api" | "self";

export interface Player {
  /** Scheme handle. Unique within a tournament. */
  handle: string;
  /** Rank as an integer step on the game's ladder (see games.ts). */
  score: number;
  role: string;
  verified: RankSource;
  checkedIn: boolean;
  /** Player karma (0–100), when the store knows it. Display only. */
  karma?: number;
  /**
   * On a team a captain registered: whether the player has answered. Absent
   * means confirmed (captains, balanced solo teams, older records).
   */
  confirmation?: "pending" | "declined";
}

export interface Team {
  /** Stable team id. The engine treats it as an opaque string. */
  id: string;
  name: string;
  captain: string;
  /** The starters. Everything the engine computes (ranks, check-in, prize shares) uses these. */
  players: Player[];
  /**
   * Substitutes registered with the team. Display only, so hosts and
   * opponents can check who's on the roster against a result screenshot.
   */
  bench?: Player[];
}

export type ResultSource = "reports" | "host" | "auto" | "dispute" | "forfeit";

export interface MatchResult {
  winner: string;
  /** Games won by the winner. */
  w: number;
  /** Games won by the loser. */
  l: number;
  by: ResultSource;
  matchId: string;
}

/**
 * Everything the engine needs to derive a bracket.
 * `slots` holds team ids in bracket order; their positions are the seeding.
 */
export interface TournamentState {
  format: FormatId;
  bestOf: 1 | 3 | 5;
  slots: string[];
  teams: Record<string, Team>;
  /** Keyed by `Match.resultKey`. */
  results: Record<string, MatchResult>;
}

export interface Match {
  id: string;
  a: string | null;
  b: string | null;
  /** Placeholder labels shown until a side is known, e.g. "Winner M1". */
  pa?: string;
  pb?: string;
  /** Slot indexes for first-round matches, so the UI can drag teams. */
  sa?: number;
  sb?: number;
  /** Key into `TournamentState.results`; null until both sides are known. */
  resultKey: string | null;
  /** Scheduling wave: matches in the same wave share a deadline. */
  wave: number;
  /** How deep into the event this match is; drives standings. */
  depth: number;
  /** Id of the match the winner feeds into, for drawing wires. */
  feeds?: string;
}

export interface Column {
  title: string;
  matches: Match[];
  note?: string;
}

export type BracketPart =
  | { kind: "bracket"; title: string; columns: Column[] }
  | { kind: "swiss"; title: string; columns: Column[] }
  | { kind: "cross"; title: string; teamIds: string[] }
  | { kind: "groups"; title: string; groups: { name: string; teamIds: string[]; slotIndexes: number[] }[] }
  | { kind: "standings"; title: string };

export interface Standing {
  teamId: string;
  wins: number;
  losses: number;
  /** Deepest match depth the team reached. */
  reach: number;
  /** Still eligible to win (not eliminated). */
  alive: boolean;
}

export interface Bracket {
  format: FormatId;
  slots: string[];
  parts: BracketPart[];
  matches: Match[];
  standings: Standing[];
  champion: string | null;
  complete: boolean;
}
