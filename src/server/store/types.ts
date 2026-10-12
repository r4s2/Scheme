import type { FormatId, GameId } from "@/engine";
import type { AuditEntry, Effects, Notice, Outcome, Profile, Roster, TournamentAgg, TournamentStatus } from "../model";

/** What the tournament library and lists need, without loading whole tournaments. */
export interface TournamentSummary {
  id: string;
  name: string;
  game: GameId;
  status: TournamentStatus;
  host: string;
  hostKarma: number;
  format: FormatId;
  signupType: "team" | "solo";
  region: string;
  entryFeeCents: number;
  teamCount: number;
  /** Seats per team. */
  teamSize: number;
  /** Teams registered (team sign-up) or players registered (solo sign-up). */
  registered: number;
  startsAt: string;
  rankMin: number;
  rankMax: number;
  /** Names of first-place teams once the event is closed. */
  winners: string[];
  /** Everyone playing in it (team players, subs and solo sign-ups), for "My tournaments". */
  players: string[];
}

/** One first place: the raw material for leaderboards. */
export interface Win {
  tournamentId: string;
  game: GameId;
  team: string;
  players: string[];
  at: string;
}

/** Someone who appears in a tournament, for the development "Acting as" switcher. */
export interface Person {
  handle: string;
  host: boolean;
  /** Team names they play for, captain first. */
  teams: { name: string; captain: boolean }[];
}

export interface StoredNotice {
  id: string;
  kind: string;
  body: string;
  link: string;
  createdAt: string;
  read: boolean;
}

export interface Store {
  /** Every published tournament (not drafts), newest start first. */
  list(): Promise<TournamentSummary[]>;
  /** First places from closed tournaments. */
  wins(): Promise<Win[]>;
  people(): Promise<Person[]>;
  /** Save a new tournament made with the wizard. */
  create(agg: TournamentAgg, effects: Effects): Promise<TournamentAgg>;
  /** Profiles with their game accounts; unknown handles are left out. */
  profiles(handles: string[]): Promise<Profile[]>;
  /** Saved teams the player captains or belongs to (including pending invites). */
  rosters(handle: string): Promise<Roster[]>;
  roster(id: string): Promise<Roster | null>;
  /** Create or update a saved team and its members. */
  saveRoster(roster: Roster): Promise<Roster>;
  /** Send notifications that aren't part of a tournament save (team invites, for example). */
  notify(notices: Notice[]): Promise<void>;
  get(id: string): Promise<TournamentAgg | null>;
  /**
   * Save an operation's result. `prev` is the copy the operation started
   * from; if someone else saved in between, this throws ConflictError and
   * nothing is written.
   */
  commit(prev: TournamentAgg, outcome: Pick<Outcome, "agg" | "effects">): Promise<TournamentAgg>;
  auditLog(id: string): Promise<AuditEntry[]>;
  notifications(handle: string): Promise<StoredNotice[]>;
  markAllRead(handle: string): Promise<void>;
}

export class ConflictError extends Error {
  constructor() {
    super("Someone else changed this tournament at the same time. Reload and try again.");
  }
}

export type { Effects };
