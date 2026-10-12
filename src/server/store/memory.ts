import type { AuditEntry, Effects, Notice, Outcome, Profile, Roster, TournamentAgg } from "../model";
import { peopleOf, summarize, winsOf } from "../summary";
import { ConflictError, type Person, type Store, type StoredNotice, type TournamentSummary, type Win } from "./types";

/**
 * In-memory store for local development and tests. Data lives for the life
 * of the server process. Copies go in and out through structuredClone so
 * callers can't mutate stored state by accident.
 */
export class MemoryStore implements Store {
  private tournaments = new Map<string, TournamentAgg>();
  private audit = new Map<string, AuditEntry[]>();
  private notices = new Map<string, StoredNotice[]>();
  private seq = 0;

  private profileMap = new Map<string, Profile>();
  private rosterMap = new Map<string, Roster>();

  constructor(seed: TournamentAgg[] = [], profiles: Profile[] = [], rosters: Roster[] = []) {
    for (const t of seed) this.tournaments.set(t.id, structuredClone(t));
    for (const p of profiles) this.profileMap.set(p.handle.toLowerCase(), structuredClone(p));
    for (const r of rosters) this.rosterMap.set(r.id, structuredClone(r));
  }

  private hostKarmaOf(handle: string) {
    return this.profileMap.get(handle.toLowerCase())?.hostKarma ?? 70;
  }

  async list(): Promise<TournamentSummary[]> {
    return [...this.tournaments.values()]
      .filter((t) => t.status !== "draft")
      .map((t) => summarize(t, this.hostKarmaOf(t.host)))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }

  async wins(): Promise<Win[]> {
    return [...this.tournaments.values()].flatMap(winsOf);
  }

  async people(): Promise<Person[]> {
    return peopleOf([...this.tournaments.values()]);
  }

  async get(id: string): Promise<TournamentAgg | null> {
    const t = this.tournaments.get(id);
    return t ? structuredClone(t) : null;
  }

  async commit(prev: TournamentAgg, outcome: Pick<Outcome, "agg" | "effects">): Promise<TournamentAgg> {
    const current = this.tournaments.get(prev.id);
    if (!current || current.version !== prev.version) throw new ConflictError();
    return this.put({ ...outcome.agg, version: prev.version + 1 }, outcome.effects);
  }

  async create(agg: TournamentAgg, effects: Effects): Promise<TournamentAgg> {
    if (this.tournaments.has(agg.id)) throw new ConflictError();
    return this.put({ ...agg, version: 1 }, effects);
  }

  private put(agg: TournamentAgg, effects: Effects): TournamentAgg {
    const saved = structuredClone(agg);
    this.tournaments.set(agg.id, saved);
    this.audit.set(agg.id, [...(this.audit.get(agg.id) ?? []), ...effects.audit]);
    this.put0(effects);
    return structuredClone(saved);
  }

  private put0(effects: Effects) {
    for (const n of effects.notices) {
      const list = this.notices.get(n.recipient) ?? [];
      list.unshift({ id: `n${++this.seq}`, kind: n.kind, body: n.body, link: n.link, createdAt: new Date().toISOString(), read: false });
      this.notices.set(n.recipient, list);
    }
  }

  async notify(notices: Notice[]): Promise<void> {
    this.put0({ audit: [], notices });
  }

  async profiles(handles: string[]): Promise<Profile[]> {
    return handles.flatMap((h) => {
      const p = this.profileMap.get(h.toLowerCase());
      return p ? [structuredClone(p)] : [];
    });
  }

  async directory(): Promise<Profile[]> {
    return [...this.profileMap.values()].map((p) => structuredClone(p)).sort((a, b) => a.handle.localeCompare(b.handle));
  }

  async setLookingForTeam(handle: string, on: boolean): Promise<void> {
    const p = this.profileMap.get(handle.toLowerCase());
    if (p) p.lookingForTeam = on;
  }

  async allRosters(): Promise<Roster[]> {
    return [...this.rosterMap.values()].map((r) => this.sortedRoster(r)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async rosters(handle: string): Promise<Roster[]> {
    const h = handle.toLowerCase();
    return [...this.rosterMap.values()]
      .filter((r) => r.captain.toLowerCase() === h || r.members.some((m) => m.handle.toLowerCase() === h))
      .map((r) => this.sortedRoster(r))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async roster(id: string): Promise<Roster | null> {
    const r = this.rosterMap.get(id);
    return r ? this.sortedRoster(r) : null;
  }

  async saveRoster(roster: Roster): Promise<Roster> {
    this.rosterMap.set(roster.id, structuredClone(roster));
    return this.sortedRoster(roster);
  }

  /** Members in the same order as the database: active before invited, then by handle. */
  private sortedRoster(r: Roster): Roster {
    const rank = (s: string) => (s === "active" ? 0 : 1);
    return { ...structuredClone(r), members: [...r.members].map((m) => ({ ...m })).sort((a, b) => rank(a.status) - rank(b.status) || a.handle.localeCompare(b.handle)) };
  }

  async auditLog(id: string): Promise<AuditEntry[]> {
    return [...(this.audit.get(id) ?? [])];
  }

  async notifications(handle: string): Promise<StoredNotice[]> {
    return [...(this.notices.get(handle) ?? [])];
  }

  async markAllRead(handle: string): Promise<void> {
    this.notices.set(handle, (this.notices.get(handle) ?? []).map((n) => ({ ...n, read: true })));
  }
}
