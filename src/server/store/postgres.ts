import postgres from "postgres";
import type { FormatId, GameId, MatchResult, Player, ResultSource, Team } from "@/engine";
import type { AuditEntry, Closure, Dispute, ExtensionRequest, Outcome, Payout, Report, TournamentAgg, TournamentStatus } from "../model";
import { ConflictError, type Store, type StoredNotice, type TournamentSummary } from "./types";

type Sql = postgres.Sql;

/**
 * Connection settings for a database URL. Supabase connections are always
 * encrypted unless the URL sets sslmode itself. Prepared statements are off
 * so Supabase's transaction pooler (port 6543) works too.
 */
export function connectionOptions(url: string): postgres.Options<Record<string, postgres.PostgresType>> {
  let host = "";
  let sslmode: string | null = null;
  try {
    const u = new URL(url);
    host = u.hostname;
    sslmode = u.searchParams.get("sslmode");
  } catch {
    // Not a parseable URL; postgres.js will report the problem when it connects.
  }
  const supabase = host.endsWith(".supabase.co") || host.endsWith(".supabase.com");
  return {
    prepare: false,
    connect_timeout: 10,
    ...(supabase && !sslmode ? { ssl: "require" as const } : {}),
  };
}

/**
 * Postgres-backed store for trusted server code. Connects with the database
 * connection string (DATABASE_URL), which bypasses row-level security, so
 * only call it after an operation has checked permissions.
 *
 * Saves run in one transaction and check the version the operation loaded.
 * Child rows that operations rewrite (players, results, reports, disputes,
 * extensions) are replaced as a set; the audit log, notifications, final
 * places and payouts are only ever added to or updated.
 */
export class PostgresStore implements Store {
  constructor(private readonly sql: Sql) {}

  static fromUrl(url: string) {
    return new PostgresStore(postgres(url, { ...connectionOptions(url), max: 5 }));
  }

  /** Resolves if the database answers within a few seconds; used to decide whether to fall back in development. */
  static async ping(url: string, timeoutSeconds = 5): Promise<void> {
    const sql = postgres(url, { ...connectionOptions(url), max: 1, connect_timeout: timeoutSeconds, onnotice: () => {} });
    try {
      await sql`select 1`;
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  }

  async close() {
    await this.sql.end();
  }

  async list(): Promise<TournamentSummary[]> {
    const rows = await this.sql<{ id: string; name: string; game: GameId; status: TournamentStatus; host: string }[]>`
      select t.id, t.name, t.game, t.status, p.handle as host
      from tournaments t join profiles p on p.id = t.host_id
      where t.status <> 'draft'
      order by t.starts_at desc`;
    return rows.map((r) => ({ ...r }));
  }

  async get(id: string): Promise<TournamentAgg | null> {
    const sql = this.sql;
    const [t] = await sql`
      select t.*, p.handle as host_handle
      from tournaments t join profiles p on p.id = t.host_id
      where t.id = ${id}`;
    if (!t) return null;

    const [teamRows, results, reports, disputes, extensions, subs, payouts, places, prizes] = await Promise.all([
      sql`
        select tt.id, tt.name, cp.handle as captain,
               coalesce(json_agg(json_build_object(
                 'handle', p.handle, 'score', tp.rank_score, 'role', tp.role,
                 'verified', tp.rank_source, 'checkedIn', tp.checked_in_at is not null
               ) order by tp.role, p.handle) filter (where tp.profile_id is not null), '[]') as players
        from tournament_teams tt
        join profiles cp on cp.id = tt.captain_id
        left join tournament_players tp on tp.tournament_team_id = tt.id
        left join profiles p on p.id = tp.profile_id
        where tt.tournament_id = ${id}
        group by tt.id, tt.name, cp.handle`,
      sql`select result_key, match_id, winner_team_id, w, l, source from match_results where tournament_id = ${id}`,
      sql`
        select r.id, r.match_id, r.team_id, p.handle as reporter, r.winner_team_id, r.w, r.l, r.created_at
        from match_reports r join profiles p on p.id = r.reporter_id
        where r.tournament_id = ${id} order by r.created_at`,
      sql`select id, match_id, status, resolution, created_at, resolved_at from disputes where tournament_id = ${id} order by created_at`,
      sql`
        select x.id, x.match_id, x.team_id, p.handle as requested_by, x.hours, x.reason, x.status, x.created_at, x.decided_at
        from extension_requests x join profiles p on p.id = x.requested_by
        where x.tournament_id = ${id} order by x.created_at`,
      sql`
        select p.handle, e.rank_score, e.role, e.rank_source
        from tournament_entries e join profiles p on p.id = e.profile_id
        where e.tournament_id = ${id} and e.status = 'sub' order by p.handle`,
      sql`
        select p.handle, po.tournament_team_id, po.place, po.amount_cents, po.release_at, po.status
        from payouts po join profiles p on p.id = po.profile_id
        where po.tournament_id = ${id} order by po.place, p.handle`,
      sql`select tournament_team_id, place from final_places where tournament_id = ${id} order by place`,
      sql`select name, claim_instructions from prizes where tournament_id = ${id} limit 1`,
    ]);

    const teams: Record<string, Team> = {};
    for (const r of teamRows) teams[r.id] = { id: r.id, name: r.name, captain: r.captain, players: r.players as Player[] };

    const resultMap: Record<string, MatchResult> = {};
    for (const r of results) resultMap[r.result_key] = { winner: r.winner_team_id, w: r.w, l: r.l, by: r.source as ResultSource, matchId: r.match_id };

    let closure: Closure | undefined;
    if (t.closed_at) {
      const byPlace: string[][] = [];
      for (const p of places) (byPlace[p.place - 1] ??= []).push(p.tournament_team_id);
      closure = {
        at: iso(t.closed_at),
        method: t.close_method,
        places: byPlace.filter(Boolean),
        message: t.close_message ?? "",
        prize: prizes[0] ? { name: prizes[0].name, claim: prizes[0].claim_instructions } : undefined,
      };
    }

    const overrides: Record<string, string> = t.deadline_overrides ?? {};
    return {
      id: t.id,
      version: t.version,
      name: t.name,
      game: t.game,
      host: t.host_handle,
      status: t.status,
      region: t.region,
      signupType: t.signup_type,
      allowExtensions: t.allow_extensions,
      houseRules: t.house_rules,
      entryFeeCents: t.entry_fee_cents,
      withholdPct: t.withhold_pct,
      payoutSplit: t.payout_split,
      matchWindowHours: t.match_window_hours,
      state: { format: t.format as FormatId, bestOf: t.best_of, slots: t.slots, teams, results: resultMap },
      schedule: { waveDeadlines: (t.wave_deadlines as Date[]).map(iso), overrides },
      subs: subs.map((s) => ({ handle: s.handle, score: s.rank_score, role: s.role, verified: s.rank_source, checkedIn: true })),
      reports: reports.map(
        (r): Report => ({ id: r.id, matchId: r.match_id, teamId: r.team_id, reporter: r.reporter, winner: r.winner_team_id, w: r.w, l: r.l, createdAt: iso(r.created_at) }),
      ),
      disputes: disputes.map(
        (d): Dispute => ({ id: d.id, matchId: d.match_id, status: d.status, resolution: d.resolution ?? undefined, createdAt: iso(d.created_at), resolvedAt: d.resolved_at ? iso(d.resolved_at) : undefined }),
      ),
      extensions: extensions.map(
        (x): ExtensionRequest => ({
          id: x.id, matchId: x.match_id, teamId: x.team_id, requestedBy: x.requested_by, hours: x.hours, reason: x.reason,
          status: x.status, createdAt: iso(x.created_at), decidedAt: x.decided_at ? iso(x.decided_at) : undefined,
        }),
      ),
      payouts: payouts.map(
        (p): Payout => ({ handle: p.handle, teamId: p.tournament_team_id, place: p.place, cents: p.amount_cents, releaseAt: iso(p.release_at), status: p.status === "pending" ? "pending" : p.status === "claimable" ? "claimable" : "claimed" }),
      ),
      closure,
      cancelReason: t.cancel_reason ?? undefined,
    };
  }

  async commit(prev: TournamentAgg, outcome: Pick<Outcome, "agg" | "effects">): Promise<TournamentAgg> {
    const a = outcome.agg;
    const { audit, notices } = outcome.effects;
    await this.sql.begin(async (sql) => {
      const updated = await sql`
        update tournaments set
          status = ${a.status},
          format = ${a.state.format},
          best_of = ${a.state.bestOf},
          slots = ${sql.array(a.state.slots)}::uuid[],
          wave_deadlines = ${sql.array(a.schedule.waveDeadlines)}::timestamptz[],
          deadline_overrides = ${sql.json(a.schedule.overrides)},
          closed_at = ${a.closure?.at ?? null},
          close_method = ${a.closure?.method ?? null},
          close_message = ${a.closure?.message ?? null},
          cancelled_at = ${a.status === "cancelled" && prev.status !== "cancelled" ? new Date().toISOString() : null},
          cancel_reason = ${a.cancelReason ?? null},
          version = version + 1
        where id = ${a.id} and version = ${prev.version}
        returning version`;
      if (updated.length === 0) throw new ConflictError();

      const players = Object.values(a.state.teams).flatMap((t) => t.players.map((p) => ({ team: t.id, p })));
      const handles = new Set<string>([
        ...players.map((x) => x.p.handle),
        ...Object.values(a.state.teams).map((t) => t.captain),
        ...a.subs.map((s) => s.handle),
        ...a.reports.map((r) => r.reporter),
        ...a.extensions.map((x) => x.requestedBy),
        ...a.payouts.map((p) => p.handle),
        ...notices.map((n) => n.recipient),
        ...audit.map((e) => e.actor),
      ]);
      const idRows = await sql`select id, handle from profiles where handle = any(${sql.array([...handles])})`;
      const idOf = new Map<string, string>(idRows.map((r) => [String(r.handle).toLowerCase(), r.id as string]));
      const pid = (h: string) => {
        const v = idOf.get(h.toLowerCase());
        if (!v) throw new Error(`Unknown player handle: ${h}`);
        return v;
      };
      const pidOrNull = (h: string) => idOf.get(h.toLowerCase()) ?? null;

      // Rosters: captains and players (check-ins, subs, swaps).
      for (const t of Object.values(a.state.teams)) {
        await sql`update tournament_teams set captain_id = ${pid(t.captain)} where id = ${t.id} and tournament_id = ${a.id}`;
      }
      // Keep each player's original check-in time and sub flag across saves.
      const existing = await sql`
        select profile_id, checked_in_at, is_sub from tournament_players
        where tournament_team_id in (select id from tournament_teams where tournament_id = ${a.id})`;
      const before = new Map(existing.map((r) => [r.profile_id as string, r]));
      await sql`delete from tournament_players where tournament_team_id in (select id from tournament_teams where tournament_id = ${a.id})`;
      if (players.length) {
        const now = new Date().toISOString();
        await sql`insert into tournament_players ${sql(
          players.map(({ team, p }) => {
            const id = pid(p.handle);
            const old = before.get(id);
            return {
              tournament_team_id: team,
              profile_id: id,
              role: p.role,
              rank_score: p.score,
              rank_source: p.verified,
              checked_in_at: p.checkedIn ? (old?.checked_in_at ?? now) : null,
              is_sub: Boolean(old?.is_sub) || prev.subs.some((s) => s.handle === p.handle),
            };
          }),
        )}`;
      }
      await sql`delete from tournament_entries where tournament_id = ${a.id} and status = 'sub'`;
      if (a.subs.length) {
        await sql`insert into tournament_entries ${sql(
          a.subs.map((s) => ({ tournament_id: a.id, profile_id: pid(s.handle), role: s.role, rank_score: s.score, rank_source: s.verified, status: "sub" })),
        )} on conflict (tournament_id, profile_id) do update set status = 'sub'`;
      }

      // Results and the records around them.
      await sql`delete from match_results where tournament_id = ${a.id}`;
      const results = Object.entries(a.state.results);
      if (results.length) {
        await sql`insert into match_results ${sql(
          results.map(([key, r]) => ({ tournament_id: a.id, result_key: key, match_id: r.matchId, winner_team_id: r.winner, w: r.w, l: r.l, source: r.by })),
        )}`;
      }
      await sql`delete from match_reports where tournament_id = ${a.id}`;
      if (a.reports.length) {
        await sql`insert into match_reports ${sql(
          a.reports.map((r) => ({ id: r.id, tournament_id: a.id, match_id: r.matchId, team_id: r.teamId, reporter_id: pid(r.reporter), winner_team_id: r.winner, w: r.w, l: r.l, created_at: r.createdAt })),
        )}`;
      }
      await sql`delete from disputes where tournament_id = ${a.id}`;
      if (a.disputes.length) {
        await sql`insert into disputes ${sql(
          a.disputes.map((d) => ({ id: d.id, tournament_id: a.id, match_id: d.matchId, status: d.status, resolution: d.resolution ?? null, created_at: d.createdAt, resolved_at: d.resolvedAt ?? null })),
        )}`;
      }
      await sql`delete from extension_requests where tournament_id = ${a.id}`;
      if (a.extensions.length) {
        await sql`insert into extension_requests ${sql(
          a.extensions.map((x) => ({
            id: x.id, tournament_id: a.id, match_id: x.matchId, team_id: x.teamId, requested_by: pid(x.requestedBy),
            hours: x.hours, reason: x.reason, status: x.status, created_at: x.createdAt, decided_at: x.decidedAt ?? null,
          })),
        )}`;
      }

      // Closing: final places and prize are written once.
      if (a.closure && !prev.closure) {
        await sql`insert into final_places ${sql(
          a.closure.places.flatMap((teams, i) => teams.map((t) => ({ tournament_id: a.id, tournament_team_id: t, place: i + 1 }))),
        )}`;
        if (a.closure.prize) {
          await sql`insert into prizes (tournament_id, name, claim_instructions) values (${a.id}, ${a.closure.prize.name}, ${a.closure.prize.claim})`;
        }
      }
      for (const p of a.payouts) {
        await sql`
          insert into payouts (tournament_id, tournament_team_id, profile_id, place, amount_cents, status, release_at, claimed_at)
          values (${a.id}, ${p.teamId}, ${pid(p.handle)}, ${p.place}, ${p.cents}, ${p.status}, ${p.releaseAt}, ${p.status === "claimed" ? new Date().toISOString() : null})
          on conflict (tournament_id, profile_id) do update set status = excluded.status, claimed_at = coalesce(payouts.claimed_at, excluded.claimed_at)`;
      }

      if (audit.length) {
        await sql`insert into audit_log ${sql(
          audit.map((e) => ({ tournament_id: a.id, actor_id: pidOrNull(e.actor), via_agent: e.viaAgent, action: e.action, summary: e.summary, created_at: e.at })),
        )}`;
      }
      const deliverable = notices.filter((n) => pidOrNull(n.recipient));
      if (deliverable.length) {
        await sql`insert into notifications ${sql(
          deliverable.map((n) => ({ profile_id: pid(n.recipient), kind: n.kind, body: n.body, link: n.link })),
        )}`;
      }
    });
    const saved = await this.get(a.id);
    if (!saved) throw new Error("Tournament disappeared during save.");
    return saved;
  }

  async auditLog(id: string): Promise<AuditEntry[]> {
    const rows = await this.sql`
      select a.created_at, coalesce(p.handle, 'Scheme') as actor, a.via_agent, a.action, a.summary
      from audit_log a left join profiles p on p.id = a.actor_id
      where a.tournament_id = ${id} order by a.created_at, a.id`;
    return rows.map((r) => ({ at: iso(r.created_at), actor: r.actor, viaAgent: r.via_agent, action: r.action, summary: r.summary }));
  }

  async notifications(handle: string): Promise<StoredNotice[]> {
    const rows = await this.sql`
      select n.id, n.kind, n.body, coalesce(n.link, '') as link, n.created_at, n.read_at is not null as read
      from notifications n join profiles p on p.id = n.profile_id
      where p.handle = ${handle} order by n.created_at desc limit 50`;
    return rows.map((r) => ({ id: r.id, kind: r.kind, body: r.body, link: r.link, createdAt: iso(r.created_at), read: r.read }));
  }

  async markAllRead(handle: string): Promise<void> {
    await this.sql`
      update notifications set read_at = now()
      where read_at is null and profile_id = (select id from profiles where handle = ${handle})`;
  }
}

function iso(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}
