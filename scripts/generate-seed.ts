/**
 * Writes supabase/seed.sql from the sample data in src/server/demo-data.ts, so
 * the database and demo mode always show the same tournaments.
 *
 *   npm run seed:generate
 *
 * Times are written relative to now(), so the data looks current whenever it
 * is loaded. Ids are derived from stable labels, so loading twice is a no-op.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GAMES } from "@/engine";
import { DEMO_HOST_KARMA, demoKarma, demoTournaments } from "@/server/demo-data";
import type { TournamentAgg } from "@/server/model";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "seed.sql");
const now = new Date();

/** UUID from a label: the same label always gives the same id. */
function uuid(label: string): string {
  const m = createHash("md5").update(label).digest("hex");
  return `${m.slice(0, 8)}-${m.slice(8, 12)}-4${m.slice(13, 16)}-8${m.slice(17, 20)}-${m.slice(20, 32)}`;
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const userId = (h: string) => uuid(`user:${h.toLowerCase()}`);
const tId = (t: TournamentAgg) => uuid(`t:${t.id}`);
const teamId = (t: TournamentAgg, team: string) => uuid(`tt:${t.id}:${team}`);
const rel = (iso: string) => {
  const secs = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  return `now() ${secs < 0 ? "-" : "+"} interval '${Math.abs(secs)} seconds'`;
};
/** Listing start times keep their Eastern clock time ("Sat, 8:00 PM ET") whenever the seed is loaded. */
const eastern = (iso: string) => {
  const tz = "America/New_York";
  const start = new Date(iso);
  const day = (d: Date) => Date.parse(d.toLocaleDateString("en-CA", { timeZone: tz }));
  const days = Math.round((day(start) - day(now)) / 86_400_000);
  const [h, m] = start.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number);
  return `((date_trunc('day', now() at time zone '${tz}') + interval '${days} days ${h} hours ${m} minutes') at time zone '${tz}')`;
};
const isoAt = (iso: string) => `to_char((${rel(iso)}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const textArray = (xs: string[]) => (xs.length ? `array[${xs.map(q).join(", ")}]::text[]` : `'{}'::text[]`);
const values = (rows: string[][]) => rows.map((r) => `  (${r.join(", ")})`).join(",\n");

const all = demoTournaments(now);

// People: everyone who plays or hosts.
const handles = new Set<string>(Object.keys(DEMO_HOST_KARMA));
for (const t of all) {
  handles.add(t.host);
  for (const team of Object.values(t.state.teams)) for (const p of team.players) handles.add(p.handle);
  for (const p of [...t.subs, ...t.pool]) handles.add(p.handle);
}
const people = [...handles].sort();

const tournaments: string[][] = [];
const teams: string[][] = [];
const players: string[][] = [];
const entries: string[][] = [];
const results: string[][] = [];
const extensions: string[][] = [];
const places: string[][] = [];
const notices: string[] = [];

for (const t of all) {
  const id = tId(t);
  const deadlines = t.schedule.waveDeadlines.length ? `array[${t.schedule.waveDeadlines.map(rel).join(", ")}]::timestamptz[]` : `'{}'::timestamptz[]`;
  const overrides = Object.keys(t.schedule.overrides).length
    ? `jsonb_build_object(${Object.entries(t.schedule.overrides).map(([m, v]) => `${q(m)}, ${isoAt(v)}`).join(", ")})`
    : `'{}'::jsonb`;
  tournaments.push([
    q(id), q(userId(t.host)), q(t.name), q(t.game), q(t.state.format), String(t.state.bestOf), q(t.signupType),
    t.signupType === "solo" ? "'even'" : "null", q(t.status), q(t.region), String(t.teamCount), textArray(GAMES[t.game].roles),
    String(t.rankMin), String(t.rankMax), t.status === "registration" ? eastern(t.startsAt) : rel(t.startsAt), String(t.matchWindowHours), String(t.allowExtensions), textArray(t.houseRules),
    String(t.entryFeeCents), String(t.withholdPct), `'{${t.payoutSplit.join(",")}}'::int[]`,
    `array[${t.state.slots.map((s) => q(teamId(t, s))).join(", ")}]::uuid[]`, deadlines, overrides,
    t.closure ? rel(t.closure.at) : "null", t.closure ? q(t.closure.method) : "null", t.closure ? q(t.closure.message) : "null",
  ]);
  for (const team of Object.values(t.state.teams)) {
    teams.push([q(teamId(t, team.id)), q(id), q(team.name), q(userId(team.captain))]);
    for (const p of team.players) {
      players.push([q(teamId(t, team.id)), q(userId(p.handle)), q(p.role), String(p.score), q(p.verified), p.checkedIn ? rel(t.startsAt) : "null"]);
    }
  }
  const signups = [...t.subs.map((p) => [p, "sub"] as const), ...t.pool.map((p) => [p, "registered"] as const)];
  signups.forEach(([p, status], i) => {
    // Earlier in the list signed up earlier.
    entries.push([q(id), q(userId(p.handle)), q(p.role), String(p.score), q(p.verified), q(status), `now() - interval '${(signups.length - i) * 13} minutes'`]);
  });
  for (const [key, r] of Object.entries(t.state.results)) {
    // Result keys hold team ids; swap in the database ids and re-sort by code point.
    const [prefix, pair] = key.includes(":") ? [key.slice(0, key.indexOf(":") + 1), key.slice(key.indexOf(":") + 1)] : ["", key];
    const ids = pair.split("|").map((x) => teamId(t, x)).sort();
    results.push([q(id), q(prefix + ids.join("|")), q(r.matchId), q(teamId(t, r.winner)), String(r.w), String(r.l), q(r.by)]);
  }
  for (const x of t.extensions) {
    extensions.push([q(uuid(`x:${t.id}:${x.id}`)), q(id), q(x.matchId), q(teamId(t, x.teamId)), q(userId(x.requestedBy)), String(x.hours), q(x.reason), q(x.status), rel(x.createdAt)]);
    if (x.status === "pending") {
      const team = t.state.teams[x.teamId].name;
      notices.push(
        `insert into notifications (profile_id, kind, body, link, created_at)\n` +
          `select ${q(userId(t.host))}, 'extension_request', ${q(`${team} asked for ${x.hours} more hour${x.hours === 1 ? "" : "s"} on ${x.matchId} in ${t.name}.`)}, ${q(`/t/${id}?tab=desk`)}, ${rel(x.createdAt)}\n` +
          `where not exists (select 1 from notifications where profile_id = ${q(userId(t.host))} and kind = 'extension_request' and link = ${q(`/t/${id}?tab=desk`)});`,
      );
    }
  }
  t.closure?.places.forEach((group, i) => group.forEach((team) => places.push([q(id), q(teamId(t, team)), String(i + 1)])));
}

const sql = `-- Sample data for development projects. Generated by \`npm run seed:generate\`
-- from src/server/demo-data.ts; edit that file, not this one.
--
-- ${all.length} tournaments: Friday Night Spike (live), Saturday Six-Stack Social
-- (check-in), ${all.filter((t) => t.status === "registration").length} open for sign-ups, and ${all.filter((t) => t.status === "complete").length} closed events whose winners fill
-- the leaderboards. Ids are stable and times are relative to now(), so this is
-- safe to run more than once: rows that already exist are skipped.

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Run the schema first (supabase/migrations, or npm run db:setup), then this file.';
  end if;
end $$;

-- People
insert into auth.users (id, email) values
${values(people.map((h) => [q(userId(h)), q(`${h.toLowerCase()}@example.test`)]))}
on conflict do nothing;

insert into profiles (id, handle, attested_13_plus, verified_18_plus, player_karma, host_karma) values
${values(people.map((h) => [q(userId(h)), q(h), "true", "true", String(demoKarma(h)), String(DEMO_HOST_KARMA[h] ?? 70)]))}
on conflict do nothing;

-- Tournaments
insert into tournaments (id, host_id, name, game, format, best_of, signup_type, balance_goal, status, region, team_count, roles,
                         rank_min_score, rank_max_score, starts_at, match_window_hours, allow_extensions, house_rules,
                         entry_fee_cents, withhold_pct, payout_split, slots, wave_deadlines, deadline_overrides,
                         closed_at, close_method, close_message) values
${values(tournaments)}
on conflict do nothing;

insert into tournament_teams (id, tournament_id, name, captain_id) values
${values(teams)}
on conflict do nothing;

insert into tournament_players (tournament_team_id, profile_id, role, rank_score, rank_source, checked_in_at) values
${values(players)}
on conflict do nothing;

insert into tournament_entries (tournament_id, profile_id, role, rank_score, rank_source, status, created_at) values
${values(entries)}
on conflict do nothing;

-- Results. result_key is the two team ids sorted by code point ("C" collation),
-- matching pairKey() in src/engine/bracket.ts.
insert into match_results (tournament_id, result_key, match_id, winner_team_id, w, l, source) values
${values(results)}
on conflict do nothing;

insert into extension_requests (id, tournament_id, match_id, team_id, requested_by, hours, reason, status, created_at) values
${values(extensions)}
on conflict do nothing;

insert into final_places (tournament_id, tournament_team_id, place) values
${values(places)}
on conflict do nothing;

-- Notifications
${notices.join("\n\n")}
`;

writeFileSync(out, sql);
console.log(`Wrote ${out}: ${all.length} tournaments, ${people.length} people, ${players.length} roster spots.`);
