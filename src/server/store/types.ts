import type { GameId } from "@/engine";
import type { AuditEntry, Effects, Outcome, TournamentAgg, TournamentStatus } from "../model";

export interface TournamentSummary {
  id: string;
  name: string;
  game: GameId;
  status: TournamentStatus;
  host: string;
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
  list(): Promise<TournamentSummary[]>;
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
