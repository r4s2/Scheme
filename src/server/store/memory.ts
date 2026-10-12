import type { AuditEntry, Outcome, TournamentAgg } from "../model";
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

  constructor(
    seed: TournamentAgg[] = [],
    private readonly hostKarma: Record<string, number> = {},
  ) {
    for (const t of seed) this.tournaments.set(t.id, structuredClone(t));
  }

  async list(): Promise<TournamentSummary[]> {
    return [...this.tournaments.values()]
      .filter((t) => t.status !== "draft")
      .map((t) => summarize(t, this.hostKarma[t.host] ?? 70))
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
    const saved = structuredClone({ ...outcome.agg, version: prev.version + 1 });
    this.tournaments.set(prev.id, saved);
    this.audit.set(prev.id, [...(this.audit.get(prev.id) ?? []), ...outcome.effects.audit]);
    for (const n of outcome.effects.notices) {
      const list = this.notices.get(n.recipient) ?? [];
      list.unshift({ id: `n${++this.seq}`, kind: n.kind, body: n.body, link: n.link, createdAt: new Date().toISOString(), read: false });
      this.notices.set(n.recipient, list);
    }
    return structuredClone(saved);
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
