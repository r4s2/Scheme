import type { AuditEntry, Effects, Notice, Outcome, Profile, Roster, TournamentAgg } from "../model";
import type { Person, Store, StoredNotice, TournamentSummary, Win } from "./types";

/** Error codes that mean "couldn't reach the database", as opposed to a query the database rejected. */
const CONNECTION_CODES = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

export function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && CONNECTION_CODES.has(code);
}

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Lost the connection to the database, so nothing was saved. Reload the page to continue on demo data.");
  }
}

export interface FallbackOptions {
  /** How long to wait after a failed check before trying the database again. */
  retryMs?: number;
  now?: () => number;
  onChange?: (online: boolean, reason?: string) => void;
}

/**
 * Development safety net: uses the database while it can be reached and the
 * demo data while it can't, re-checking in the background so it switches back
 * on its own. Never used in production, where a missing database must fail
 * loudly instead of quietly showing sample data.
 */
export class FallbackStore implements Store {
  private state: "unknown" | "up" | "down" = "unknown";
  private lastCheck = 0;
  private checking: Promise<void> | null = null;
  private demoStore: Store | null = null;
  /** Which store each loaded tournament came from, so its save goes back to the same place. */
  private readonly origin = new WeakMap<TournamentAgg, Store>();
  private readonly retryMs: number;
  private readonly now: () => number;

  constructor(
    private readonly db: Store,
    private readonly makeDemo: () => Store,
    private readonly ping: () => Promise<void>,
    private readonly opts: FallbackOptions = {},
  ) {
    this.retryMs = opts.retryMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  async close(): Promise<void> {
    await (this.db as { close?: () => Promise<void> }).close?.();
  }

  /** True when the last check reached the database. */
  get online(): boolean {
    return this.state === "up";
  }

  private get demo(): Store {
    return (this.demoStore ??= this.makeDemo());
  }

  private setState(next: "up" | "down", reason?: string) {
    if (next !== this.state) this.opts.onChange?.(next === "up", reason);
    this.state = next;
  }

  private check(): Promise<void> {
    this.checking ??= this.ping()
      .then(
        () => this.setState("up"),
        (e: unknown) => this.setState("down", (e as Error)?.message),
      )
      .finally(() => {
        this.lastCheck = this.now();
        this.checking = null;
      });
    return this.checking;
  }

  private async pick(): Promise<Store> {
    if (this.state === "unknown") await this.check();
    else if (this.state === "down" && this.now() - this.lastCheck >= this.retryMs) void this.check();
    return this.state === "up" ? this.db : this.demo;
  }

  private markDown(e: unknown) {
    this.lastCheck = this.now();
    this.setState("down", (e as Error)?.message);
  }

  /** Reads fall back to demo data if the connection drops mid-request. */
  private async read<T>(run: (s: Store) => Promise<T>): Promise<T> {
    const s = await this.pick();
    if (s !== this.db) return run(s);
    try {
      return await run(s);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      this.markDown(e);
      return run(this.demo);
    }
  }

  list(): Promise<TournamentSummary[]> {
    return this.read((s) => s.list());
  }

  profiles(handles: string[]): Promise<Profile[]> {
    return this.read((s) => s.profiles(handles));
  }

  directory(): Promise<Profile[]> {
    return this.read((s) => s.directory());
  }

  setLookingForTeam(handle: string, on: boolean): Promise<void> {
    return this.write((s) => s.setLookingForTeam(handle, on));
  }

  allRosters(): Promise<Roster[]> {
    return this.read((s) => s.allRosters());
  }

  rosters(handle: string): Promise<Roster[]> {
    return this.read((s) => s.rosters(handle));
  }

  roster(id: string): Promise<Roster | null> {
    return this.read((s) => s.roster(id));
  }

  /** Writes outside a tournament go wherever reads currently go; a dropped connection fails rather than switching. */
  private async write<T>(run: (s: Store) => Promise<T>): Promise<T> {
    const s = await this.pick();
    try {
      return await run(s);
    } catch (e) {
      if (s !== this.db || !isConnectionError(e)) throw e;
      this.markDown(e);
      throw new DatabaseUnavailableError();
    }
  }

  notify(notices: Notice[]): Promise<void> {
    return this.write((s) => s.notify(notices));
  }

  saveRoster(roster: Roster): Promise<Roster> {
    return this.write((s) => s.saveRoster(roster));
  }

  create(agg: TournamentAgg, effects: Effects): Promise<TournamentAgg> {
    return this.write(async (s) => this.tag(await s.create(agg, effects), s));
  }

  wins(): Promise<Win[]> {
    return this.read((s) => s.wins());
  }

  people(): Promise<Person[]> {
    return this.read((s) => s.people());
  }

  get(id: string): Promise<TournamentAgg | null> {
    return this.read(async (s) => this.tag(await s.get(id), s));
  }

  private tag<T extends TournamentAgg | null>(agg: T, s: Store): T {
    if (agg) this.origin.set(agg, s);
    return agg;
  }

  auditLog(id: string): Promise<AuditEntry[]> {
    return this.read((s) => s.auditLog(id));
  }

  notifications(handle: string): Promise<StoredNotice[]> {
    return this.read((s) => s.notifications(handle));
  }

  markAllRead(handle: string): Promise<void> {
    return this.read((s) => s.markAllRead(handle));
  }

  /**
   * Saves go to the store the tournament was loaded from and never switch
   * halfway: a save meant for the database fails rather than landing in demo
   * data.
   */
  async commit(prev: TournamentAgg, outcome: Pick<Outcome, "agg" | "effects">): Promise<TournamentAgg> {
    const s = this.origin.get(prev) ?? (await this.pick());
    if (s !== this.db) return this.tag(await s.commit(prev, outcome), s);
    try {
      return this.tag(await s.commit(prev, outcome), s);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      this.markDown(e);
      throw new DatabaseUnavailableError();
    }
  }
}
