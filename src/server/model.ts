import type { CloseMethod, GameId, Player, RankSource, Schedule, TournamentState } from "@/engine";

/**
 * The tournament aggregate: everything one tournament's operations read and
 * change, loaded and saved as a unit. Operations in operations.ts are pure
 * functions from (aggregate, request) to (new aggregate, effects); stores
 * only persist the result.
 *
 * People are identified by handle; teams by the engine's team id (in the
 * database, the tournament_teams uuid).
 */

/**
 * How a tournament uses its rank range: no range, a suggestion players see
 * (and can filter by) but may sign up outside of, or a requirement.
 */
export type RankRule = "open" | "suggested" | "required";

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

export interface Announcement {
  id: string;
  /** "all", "captains", or a team id. */
  audience: string;
  body: string;
  sentBy: string;
  createdAt: string;
}

export interface TicketMessage {
  id: string;
  /** Null for system messages. */
  author: string | null;
  body: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  openedBy: string;
  teamId?: string;
  matchId?: string;
  category: "result" | "player" | "rules" | "schedule" | "other";
  subject: string;
  status: "open" | "answered" | "closed";
  createdAt: string;
  messages: TicketMessage[];
}

/** A player's linked account for one game: where their rank comes from. */
export interface GameAccount {
  game: GameId;
  /** Riot ID, BattleTag or Marvel Rivals UID, as shown to others. */
  accountName: string;
  rankScore: number;
  source: RankSource;
  roles: string[];
}

export interface Profile {
  handle: string;
  playerKarma: number;
  hostKarma: number;
  accounts: GameAccount[];
  /** Open to joining a team; shown to captains as recruitable. */
  lookingForTeam: boolean;
}

/** A saved team: a captain and members who play one game together across events. */
export interface Roster {
  id: string;
  name: string;
  game: GameId;
  captain: string;
  members: { handle: string; role: string | null; status: "invited" | "active" }[];
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
  /** When play starts (ISO). */
  startsAt: string;
  /** Teams the event is built for (4, 8, 16 or 32). */
  teamCount: number;
  /** Rank range, as ladder scores. With rankRule "open" it spans the whole ladder. */
  rankMin: number;
  rankMax: number;
  rankRule: RankRule;
  /** One entry per seat on a team, e.g. Overwatch 5v5 or 6v6. */
  roles: string[];
  /** Most substitutes a team can register on top of its starters. */
  benchMax: number;
  requirements: { minKarma: number; verifiedOnly: boolean };
  /** How solo sign-ups are turned into teams. */
  balanceGoal: "even" | "tiers";
  /** Check-in opens this many minutes before the start. */
  checkinMinutes: number;
  state: TournamentState;
  schedule: Schedule;
  /** Free agents available to replace no-shows. */
  subs: Player[];
  /**
   * Solo sign-ups not yet placed on a team (solo events during registration).
   * Read-only for now: the balancer that turns them into teams comes with
   * registration.
   */
  pool: Player[];
  reports: Report[];
  disputes: Dispute[];
  extensions: ExtensionRequest[];
  payouts: Payout[];
  announcements: Announcement[];
  tickets: Ticket[];
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
