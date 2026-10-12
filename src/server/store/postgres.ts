import postgres from "postgres";
import type { FormatId, MatchResult, Player, ResultSource, Team } from "@/engine";
import type { AuditEntry, Closure, Dispute, Effects, ExtensionRequest, Notice, Outcome, Payout, Profile, Report, Roster, TournamentAgg } from "../model";
import { sortPeople } from "../summary";
import { ConflictError, type Person, type Store, type StoredNotice, type TournamentSummary, type Win } from "./types";

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

const entryPlayer = (e: postgres.Row): Player => ({ handle: e.handle, score: e.rank_score, role: e.role, verified: e.rank_source, checkedIn: true, karma: e.player_karma });

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
    // SCHEME_SQL_LOG=1 prints every query, to spot pages that make too many round trips.
    const debug = process.env.SCHEME_SQL_LOG === "1" ? (_c: number, q: string) => console.log(`[sql] ${q.replace(/\s+/g, " ").slice(0, 90)}`) : undefined;
    return new PostgresStore(postgres(url, { ...connectionOptions(url), max: 10, debug }));
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
    const rows = await this.sql`
      select t.id, t.name, t.game, t.status, p.handle::text as host, p.host_karma, t.format, t.signup_type, t.region,
             t.entry_fee_cents, t.team_count, cardinality(t.roles) as team_size, t.starts_at, t.rank_min_score, t.rank_max_score,
             case when t.signup_type = 'solo'
               then (select count(*) from tournament_players tp join tournament_teams tt on tt.id = tp.tournament_team_id where tt.tournament_id = t.id)
                  + (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status = 'registered')
               else (select count(*) from tournament_teams tt where tt.tournament_id = t.id)
             end::int as registered,
             coalesce((select array_agg(tt.name order by tt.name) from final_places fp join tournament_teams tt on tt.id = fp.tournament_team_id
                       where fp.tournament_id = t.id and fp.place = 1 and t.status = 'complete'), '{}')::text[] as winners,
             coalesce((select array_agg(distinct pp.handle::text) from (
                         select tp.profile_id from tournament_players tp join tournament_teams tt on tt.id = tp.tournament_team_id where tt.tournament_id = t.id
                         union select e.profile_id from tournament_entries e where e.tournament_id = t.id and e.status in ('registered', 'sub')
                       ) x join profiles pp on pp.id = x.profile_id), '{}')::text[] as players
      from tournaments t join profiles p on p.id = t.host_id
      where t.status <> 'draft'
      order by t.starts_at desc`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      game: r.game,
      status: r.status,
      host: r.host,
      hostKarma: r.host_karma,
      format: r.format,
      signupType: r.signup_type,
      region: r.region,
      entryFeeCents: r.entry_fee_cents,
      teamCount: r.team_count,
      teamSize: r.team_size,
      registered: r.registered,
      startsAt: iso(r.starts_at),
      rankMin: r.rank_min_score,
      rankMax: r.rank_max_score,
      winners: r.winners,
      players: r.players,
    }));
  }

  async wins(): Promise<Win[]> {
    const rows = await this.sql`
      select t.id, t.game, tt.name, t.closed_at,
             coalesce(array_agg(p.handle::text order by p.handle) filter (where p.id is not null), '{}')::text[] as players
      from final_places fp
      join tournaments t on t.id = fp.tournament_id and t.status = 'complete'
      join tournament_teams tt on tt.id = fp.tournament_team_id
      left join tournament_players tp on tp.tournament_team_id = tt.id
      left join profiles p on p.id = tp.profile_id
      where fp.place = 1
      group by t.id, t.game, tt.id, tt.name, t.closed_at`;
    return rows.map((r) => ({ tournamentId: r.id, game: r.game, team: r.name, players: r.players, at: iso(r.closed_at ?? new Date()) }));
  }

  async people(): Promise<Person[]> {
    const rows = await this.sql`
      select handle, bool_or(is_host) as host,
             coalesce(json_agg(distinct jsonb_build_object('name', team, 'captain', captain)) filter (where team is not null), '[]') as teams
      from (
        select p.handle::text as handle, true as is_host, null::text as team, false as captain
        from tournaments t join profiles p on p.id = t.host_id
        where t.status in ('registration', 'checkin', 'live')
        union all
        select p.handle::text, false, tt.name, tt.captain_id = p.id
        from tournaments t
        join tournament_teams tt on tt.tournament_id = t.id
        join tournament_players tp on tp.tournament_team_id = tt.id
        join profiles p on p.id = tp.profile_id
        where t.status in ('registration', 'checkin', 'live')
      ) x
      group by handle`;
    return sortPeople(
      rows.map((r) => ({
        handle: r.handle,
        host: r.host,
        teams: (r.teams as { name: string; captain: boolean }[]).filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i),
      })),
    );
  }

  async get(id: string): Promise<TournamentAgg | null> {
    const sql = this.sql;
    const [t] = await sql`
      select t.*, p.handle as host_handle
      from tournaments t join profiles p on p.id = t.host_id
      where t.id = ${id}`;
    if (!t) return null;

    const [teamRows, results, reports, disputes, extensions, entries, payouts, places, prizes, announcements, tickets] = await Promise.all([
      sql`
        select tt.id, tt.name, cp.handle as captain,
               coalesce(json_agg(json_build_object(
                 'handle', p.handle, 'score', tp.rank_score, 'role', tp.role,
                 'verified', tp.rank_source, 'checkedIn', tp.checked_in_at is not null, 'karma', p.player_karma
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
        select p.handle, e.rank_score, e.role, e.rank_source, e.status, p.player_karma
        from tournament_entries e join profiles p on p.id = e.profile_id
        where e.tournament_id = ${id} and e.status in ('sub', 'registered') order by e.created_at, p.handle`,
      sql`
        select p.handle, po.tournament_team_id, po.place, po.amount_cents, po.release_at, po.status
        from payouts po join profiles p on p.id = po.profile_id
        where po.tournament_id = ${id} order by po.place, p.handle`,
      sql`select tournament_team_id, place from final_places where tournament_id = ${id} order by place`,
      sql`select name, claim_instructions from prizes where tournament_id = ${id} limit 1`,
      sql`
        select a.id, a.audience, a.body, coalesce(p.handle::text, '') as sent_by, a.created_at
        from announcements a left join profiles p on p.id = a.sent_by
        where a.tournament_id = ${id} order by a.created_at`,
      sql`
        select k.id, op.handle::text as opened_by, k.team_id, k.match_id, k.category, k.subject, k.status, k.created_at,
               coalesce((select json_agg(json_build_object('id', m.id, 'author', ap.handle::text, 'body', m.body, 'createdAt', m.created_at) order by m.created_at)
                         from ticket_messages m left join profiles ap on ap.id = m.author_id
                         where m.ticket_id = k.id and not m.is_agent_draft), '[]') as messages
        from tickets k join profiles op on op.id = k.opened_by
        where k.tournament_id = ${id} order by k.created_at`,
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
      startsAt: iso(t.starts_at),
      teamCount: t.team_count,
      rankMin: t.rank_min_score,
      rankMax: t.rank_max_score,
      roles: t.roles,
      requirements: { minKarma: t.min_player_karma, verifiedOnly: t.verified_ranks_only },
      balanceGoal: t.balance_goal ?? "even",
      checkinMinutes: t.checkin_minutes,
      announcements: announcements.map((x) => ({ id: x.id, audience: x.audience, body: x.body, sentBy: x.sent_by, createdAt: iso(x.created_at) })),
      tickets: tickets.map((k) => ({
        id: k.id,
        openedBy: k.opened_by,
        teamId: k.team_id ?? undefined,
        matchId: k.match_id ?? undefined,
        category: k.category,
        subject: k.subject,
        status: k.status,
        createdAt: iso(k.created_at),
        messages: (k.messages as { id: string; author: string | null; body: string; createdAt: string }[]).map((m) => ({ ...m, createdAt: iso(m.createdAt) })),
      })),
      state: { format: t.format as FormatId, bestOf: t.best_of, slots: t.slots, teams, results: resultMap },
      schedule: { waveDeadlines: (t.wave_deadlines as Date[]).map(iso), overrides },
      subs: entries.filter((e) => e.status === "sub").map(entryPlayer),
      pool: entries.filter((e) => e.status === "registered").map(entryPlayer),
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
        ...a.pool.map((s) => s.handle),
        ...a.announcements.map((x) => x.sentBy),
        ...a.tickets.flatMap((k) => [k.openedBy, ...k.messages.flatMap((m) => (m.author ? [m.author] : []))]),
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
      // Teams: registration adds and removes them; afterwards only captains change.
      const teamRows = Object.values(a.state.teams).map((t) => ({ id: t.id, tournament_id: a.id, name: t.name, captain_id: pid(t.captain) }));
      if (teamRows.length) {
        await sql`insert into tournament_teams ${sql(teamRows)} on conflict (id) do update set captain_id = excluded.captain_id, name = excluded.name`;
      }
      if (prev.status === "registration") {
        await sql`delete from tournament_teams where tournament_id = ${a.id} and not (id = any(${sql.array(teamRows.map((t) => t.id))}::uuid[]))`;
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
      await sql`delete from tournament_entries where tournament_id = ${a.id} and status in ('sub', 'registered')`;
      if (a.pool.length) {
        await sql`insert into tournament_entries ${sql(
          a.pool.map((s) => ({ tournament_id: a.id, profile_id: pid(s.handle), role: s.role, rank_score: s.score, rank_source: s.verified, status: "registered" })),
        )} on conflict (tournament_id, profile_id) do update set status = 'registered', role = excluded.role`;
      }
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

      // Announcements and tickets only ever grow; tickets change status.
      if (a.announcements.length) {
        await sql`insert into announcements ${sql(
          a.announcements.map((x) => ({ id: x.id, tournament_id: a.id, audience: x.audience, channels: sql.array(["app"]), body: x.body, sent_by: pidOrNull(x.sentBy), created_at: x.createdAt })),
        )} on conflict (id) do nothing`;
      }
      if (a.tickets.length) {
        await sql`insert into tickets ${sql(
          a.tickets.map((k) => ({
            id: k.id, tournament_id: a.id, opened_by: pid(k.openedBy), team_id: k.teamId ?? null, match_id: k.matchId ?? null,
            category: k.category, subject: k.subject, status: k.status, created_at: k.createdAt,
          })),
        )} on conflict (id) do update set status = excluded.status`;
        const msgs = a.tickets.flatMap((k) => k.messages.map((m) => ({ id: m.id, ticket_id: k.id, author_id: m.author ? pidOrNull(m.author) : null, body: m.body, created_at: m.createdAt })));
        if (msgs.length) await sql`insert into ticket_messages ${sql(msgs)} on conflict (id) do nothing`;
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

  async create(agg: TournamentAgg, effects: Effects): Promise<TournamentAgg> {
    const [host] = await this.sql`select id from profiles where handle = ${agg.host}`;
    if (!host) throw new Error(`Unknown host: ${agg.host}`);
    await this.sql`
      insert into tournaments (id, host_id, name, game, format, best_of, signup_type, balance_goal, status, region, team_count, roles,
                               rank_min_score, rank_max_score, min_player_karma, verified_ranks_only, starts_at, checkin_minutes,
                               match_window_hours, allow_extensions, house_rules, entry_fee_cents, withhold_pct, payout_split, version)
      values (${agg.id}, ${host.id}, ${agg.name}, ${agg.game}, ${agg.state.format}, ${agg.state.bestOf}, ${agg.signupType},
              ${agg.signupType === "solo" ? agg.balanceGoal : null}, 'draft', ${agg.region}, ${agg.teamCount}, ${this.sql.array(agg.roles)},
              ${agg.rankMin}, ${agg.rankMax}, ${agg.requirements.minKarma}, ${agg.requirements.verifiedOnly}, ${agg.startsAt}, ${agg.checkinMinutes},
              ${agg.matchWindowHours}, ${agg.allowExtensions}, ${this.sql.array(agg.houseRules)}, ${agg.entryFeeCents}, ${agg.withholdPct},
              ${this.sql.array(agg.payoutSplit)}::int[], 0)`;
    // The rest (status, teams, notices, audit) goes through the normal save from an empty draft.
    return this.commit({ ...agg, version: 0, status: "draft", state: { ...agg.state, teams: {}, slots: [], results: {} }, pool: [], subs: [], announcements: [], tickets: [] }, { agg, effects });
  }

  async notify(notices: Notice[]): Promise<void> {
    if (!notices.length) return;
    await this.sql`
      insert into notifications (profile_id, kind, body, link)
      select p.id, n.kind, n.body, n.link
      from jsonb_to_recordset(${this.sql.json(notices.map((n) => ({ ...n })))}) as n (recipient text, kind text, body text, link text)
      join profiles p on lower(p.handle) = lower(n.recipient)`;
  }

  async profiles(handles: string[]): Promise<Profile[]> {
    if (!handles.length) return [];
    const rows = await this.sql`
      select p.handle::text as handle, p.player_karma, p.host_karma,
             coalesce(json_agg(json_build_object('game', g.game, 'accountName', g.account_name, 'rankScore', g.rank_score, 'source', g.rank_source, 'roles', g.roles)
                      order by g.game) filter (where g.id is not null), '[]') as accounts
      from profiles p left join game_accounts g on g.profile_id = p.id
      where lower(p.handle) in (select jsonb_array_elements_text(${this.sql.json(handles.map((h) => h.toLowerCase()))}))
      group by p.id`;
    const byHandle = new Map(rows.map((r) => [String(r.handle).toLowerCase(), r]));
    return handles.flatMap((h) => {
      const r = byHandle.get(h.toLowerCase());
      return r ? [{ handle: r.handle, playerKarma: r.player_karma, hostKarma: r.host_karma, accounts: r.accounts }] : [];
    });
  }

  private async rosterRows(where: postgres.PendingQuery<postgres.Row[]>): Promise<Roster[]> {
    const rows = await this.sql`
      select t.id, t.name, t.game, c.handle::text as captain,
             coalesce(json_agg(json_build_object('handle', p.handle::text, 'role', m.role, 'status', m.status) order by m.status, p.handle)
                      filter (where m.status in ('invited', 'active')), '[]') as members
      from teams t join profiles c on c.id = t.captain_id
      left join team_members m on m.team_id = t.id
      left join profiles p on p.id = m.profile_id
      where ${where}
      group by t.id, c.handle
      order by t.name`;
    const rank = (st: string) => (st === "active" ? 0 : 1);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      game: r.game,
      captain: r.captain,
      // Same order as the in-memory store: active before invited, then by handle.
      members: (r.members as Roster["members"]).sort((a, b) => rank(a.status) - rank(b.status) || a.handle.localeCompare(b.handle)),
    }));
  }

  rosters(handle: string): Promise<Roster[]> {
    return this.rosterRows(this.sql`t.id in (
      select tm.team_id from team_members tm join profiles x on x.id = tm.profile_id where lower(x.handle) = ${handle.toLowerCase()} and tm.status in ('invited', 'active')
      union select tt.id from teams tt join profiles y on y.id = tt.captain_id where lower(y.handle) = ${handle.toLowerCase()})`);
  }

  async roster(id: string): Promise<Roster | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return (await this.rosterRows(this.sql`t.id = ${id}`))[0] ?? null;
  }

  async saveRoster(r: Roster): Promise<Roster> {
    await this.sql.begin(async (sql) => {
      const handles = [r.captain, ...r.members.map((m) => m.handle)];
      const ids = await sql`select id, handle::text as handle from profiles where lower(handle) in (select jsonb_array_elements_text(${sql.json(handles.map((h) => h.toLowerCase()))}))`;
      const pid = (h: string) => {
        const row = ids.find((x) => x.handle.toLowerCase() === h.toLowerCase());
        if (!row) throw new Error(`Unknown player handle: ${h}`);
        return row.id as string;
      };
      await sql`
        insert into teams (id, name, game, captain_id) values (${r.id}, ${r.name}, ${r.game}, ${pid(r.captain)})
        on conflict (id) do update set name = excluded.name, captain_id = excluded.captain_id`;
      await sql`delete from team_members where team_id = ${r.id}`;
      if (r.members.length) {
        await sql`insert into team_members ${sql(
          r.members.map((m) => ({ team_id: r.id, profile_id: pid(m.handle), role: m.role, status: m.status, joined_at: m.status === "active" ? new Date().toISOString() : null })),
        )}`;
      }
    });
    return (await this.roster(r.id))!;
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
