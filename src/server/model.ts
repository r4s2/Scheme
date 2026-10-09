import type { CloseMethod, GameId, Player, Schedule, TournamentState } from "@/engine";

/**
 * The tournament aggregate: everything one tournament's operations read and
 * change, loaded and saved as a unit. Operations in operations.ts are pure
 * functions from (aggregate, request) to (new aggregate, effects); stores
 * only persist the result.
 *
 * People are identified by handle; teams by the engine's team id (in the
 * database, the tournament_teams uuid).
 */

export type TournamentStatus = "draft" | "registration" | "checkin" | "live" | "complete" | "cancelled";

export interface Report {
  id: string;
  matchId: string;
  teamId: string;
  reporter: string;
  winner: string;
  w: number;
  l: number;
  createdAt: string;
}

export interface Dispute {
  id: string;
  matchId: string;
  status: "open" | "resolved";
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ExtensionRequest {
  id: string;
  matchId: string;
  teamId: string;
  requestedBy: string;
  hours: number;
  reason: string;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  decidedAt?: string;
}

export interface Payout {
  handle: string;
  teamId: string;
  place: number;
  cents: number;
  releaseAt: string;
  status: "pending" | "claimable" | "claimed";
}

export interface Closure {
  at: string;
  method: CloseMethod;
  places: string[][];
  message: string;
  prize?: { name: string; claim: string };
}

export interface TournamentAgg {
  id: string;
  /** Optimistic-locking version; stores reject saves from a stale copy. */
  version: number;
  name: string;
  game: GameId;
  host: string;
  status: TournamentStatus;
  region: string;
  signupType: "team" | "solo";
  allowExtensions: boolean;
  houseRules: string[];
  entryFeeCents: number;
  withholdPct: number;
  payoutSplit: number[];
  matchWindowHours: number;
  state: TournamentState;
  schedule: Schedule;
  /** Free agents available to replace no-shows. */
  subs: Player[];
  reports: Report[];
  disputes: Dispute[];
  extensions: ExtensionRequest[];
  payouts: Payout[];
  closure?: Closure;
  cancelReason?: string;
}

export interface AuditEntry {
  at: string;
  actor: string;
  viaAgent: boolean;
  action: string;
  summary: string;
}

export interface Notice {
  recipient: string;
  kind: string;
  body: string;
  link: string;
}

export interface Effects {
  audit: AuditEntry[];
  notices: Notice[];
}

export interface Outcome {
  agg: TournamentAgg;
  effects: Effects;
  /** One-line confirmation for the UI. */
  message: string;
}

export interface Ctx {
  now: Date;
  /** Handle of the person acting. */
  actor: string;
  /** True when the host approved an agent proposal. */
  viaAgent?: boolean;
  newId: () => string;
}

/** A refused operation. The message is safe to show to the user. */
export class OperationError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "invalid" | "conflict" | "not_found" = "invalid",
  ) {
    super(message);
  }
}
