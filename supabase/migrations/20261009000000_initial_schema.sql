-- Scheme initial schema
--
-- Conventions
--   * Money is integer cents.
--   * Ranks are integer steps on each game's ladder (see src/engine/games.ts).
--   * Clients read through row-level security. Every write that changes a
--     tournament, result, rank, karma or money goes through server code that
--     runs the engine first and uses the service role. That is why most tables
--     below have SELECT policies only.

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type game_id as enum ('val', 'mr', 'ow', 'lol');
create type format_id as enum ('single', 'double', 'rr', 'swiss', 'groups');
create type tournament_status as enum ('draft', 'registration', 'checkin', 'live', 'complete', 'cancelled');
create type signup_type as enum ('team', 'solo');
create type balance_goal as enum ('even', 'tiers');
create type rank_source as enum ('api', 'self');
create type result_source as enum ('reports', 'host', 'auto', 'dispute', 'forfeit');
create type request_status as enum ('pending', 'approved', 'declined');
create type dispute_status as enum ('open', 'resolved');
create type ticket_status as enum ('open', 'answered', 'closed');
create type karma_kind as enum ('player', 'host');
create type close_method as enum ('bracket', 'pick', 'co_winners', 'standings');
create type payment_status as enum ('pending', 'succeeded', 'refunded', 'failed');
create type payout_status as enum ('pending', 'claimable', 'claimed', 'paid', 'failed');
create type entry_status as enum ('registered', 'placed', 'sub', 'withdrawn');
create type member_status as enum ('invited', 'active', 'left');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle citext not null unique check (handle ~ '^[A-Za-z0-9_.-]{2,24}$'),
  timezone text not null default 'America/New_York',
  discord_user_id text unique,
  -- Age is attested at sign-up; paid events additionally require
  -- the payment provider's identity check.
  attested_13_plus boolean not null default false,
  verified_18_plus boolean not null default false,
  player_karma int not null default 70 check (player_karma between 0 and 100),
  host_karma int not null default 70 check (host_karma between 0 and 100),
  created_at timestamptz not null default now()
);

create table game_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  game game_id not null,
  -- Riot PUUID, Battle.net account id, or Marvel Rivals UID.
  external_id text not null,
  account_name text not null,
  rank_score int not null check (rank_score >= 0),
  roles text[] not null default '{}',
  rank_source rank_source not null,
  -- Screenshot path in storage for self-reported ranks.
  evidence_path text,
  verified_at timestamptz,
  last_read_at timestamptz not null default now(),
  unique (profile_id, game),
  unique (game, external_id)
);

-- Saved recreational rosters.
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  game game_id not null,
  captain_id uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  role text,
  status member_status not null default 'invited',
  joined_at timestamptz,
  primary key (team_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- Tournaments
-- ---------------------------------------------------------------------------
create table tournaments (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles (id),
  name text not null,
  game game_id not null,
  format format_id not null,
  best_of int not null default 3 check (best_of in (1, 3, 5)),
  signup_type signup_type not null,
  balance_goal balance_goal,
  status tournament_status not null default 'draft',
  region text not null default 'NA',
  team_count int not null check (team_count in (4, 8, 16, 32)),
  -- Seats per team, e.g. {Tank,Damage,Damage,Support,Support}.
  roles text[] not null,
  rank_min_score int not null default 0,
  rank_max_score int not null,
  min_player_karma int not null default 0,
  verified_ranks_only boolean not null default true,
  starts_at timestamptz not null,
  checkin_minutes int not null default 60,
  match_window_hours int not null default 24,
  allow_extensions boolean not null default true,
  house_rules text[] not null default '{}',
  -- Money. Free events have entry_fee_cents = 0.
  entry_fee_cents int not null default 0 check (entry_fee_cents >= 0),
  withhold_pct int not null default 0 check (withhold_pct between 0 and 100),
  payout_split int[] not null default '{60,30,10}',
  -- Bracket order: tournament_teams ids, in slot order. Set when the bracket is built.
  slots uuid[] not null default '{}',
  -- Engine Schedule: wave deadlines plus per-match overrides from extensions.
  wave_deadlines timestamptz[] not null default '{}',
  deadline_overrides jsonb not null default '{}',
  riot_visibility_form_ack boolean not null default false,
  closed_at timestamptz,
  close_method close_method,
  close_message text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rank_min_score <= rank_max_score),
  check (signup_type = 'team' or balance_goal is not null)
);
create index tournaments_listing on tournaments (status, game, starts_at);

-- Teams as they play in one tournament: a snapshot of a saved roster, or a
-- team the balancer built from solo sign-ups.
create table tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  source_team_id uuid references teams (id),
  name text not null,
  captain_id uuid not null references profiles (id),
  unique (tournament_id, name)
);

create table tournament_players (
  tournament_team_id uuid not null references tournament_teams (id) on delete cascade,
  profile_id uuid not null references profiles (id),
  role text not null,
  -- Rank snapshot at registration; re-checked before registration closes.
  rank_score int not null,
  rank_source rank_source not null,
  checked_in_at timestamptz,
  is_sub boolean not null default false,
  primary key (tournament_team_id, profile_id)
);

-- Solo sign-ups before the balancer places them, plus the sub list.
create table tournament_entries (
  tournament_id uuid not null references tournaments (id) on delete cascade,
  profile_id uuid not null references profiles (id),
  role text not null,
  rank_score int not null,
  rank_source rank_source not null,
  status entry_status not null default 'registered',
  created_at timestamptz not null default now(),
  primary key (tournament_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- Matches. Matches themselves are derived by the engine from slots + results,
-- so only results and the things around them are stored.
-- ---------------------------------------------------------------------------
create table match_results (
  tournament_id uuid not null references tournaments (id) on delete cascade,
  -- Engine Match.resultKey, e.g. "<teamA>|<teamB>" or "L:<teamA>|<teamB>".
  result_key text not null,
  match_id text not null,
  winner_team_id uuid not null references tournament_teams (id),
  w int not null,
  l int not null,
  source result_source not null,
  recorded_by uuid references profiles (id),
  recorded_at timestamptz not null default now(),
  primary key (tournament_id, result_key)
);

create table match_reports (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  match_id text not null,
  team_id uuid not null references tournament_teams (id),
  reporter_id uuid not null references profiles (id),
  winner_team_id uuid not null references tournament_teams (id),
  w int not null,
  l int not null,
  screenshot_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (tournament_id, match_id, team_id)
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  match_id text not null,
  status dispute_status not null default 'open',
  resolution text,
  resolved_by uuid references profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_open_dispute_per_match on disputes (tournament_id, match_id) where status = 'open';

create table extension_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  match_id text not null,
  team_id uuid not null references tournament_teams (id),
  requested_by uuid not null references profiles (id),
  hours int not null check (hours between 1 and 72),
  reason text not null default '',
  status request_status not null default 'pending',
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table match_ratings (
  tournament_id uuid not null references tournaments (id) on delete cascade,
  match_id text not null,
  rater_team_id uuid not null references tournament_teams (id),
  rated_team_id uuid not null references tournament_teams (id),
  rater_id uuid not null references profiles (id),
  tags text[] not null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, match_id, rater_team_id)
);

-- ---------------------------------------------------------------------------
-- Communication
-- ---------------------------------------------------------------------------
create table tickets (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  opened_by uuid not null references profiles (id),
  team_id uuid references tournament_teams (id),
  match_id text,
  category text not null,
  subject text not null,
  status ticket_status not null default 'open',
  created_at timestamptz not null default now()
);

create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  author_id uuid references profiles (id),
  body text not null,
  -- Agent drafts are visible to the host only until sent.
  is_agent_draft boolean not null default false,
  created_at timestamptz not null default now()
);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  audience text not null default 'all',
  channels text[] not null,
  body text not null,
  sent_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_unread on notifications (profile_id, created_at desc) where read_at is null;

create table discord_connections (
  tournament_id uuid primary key references tournaments (id) on delete cascade,
  guild_id text not null,
  guild_name text not null,
  read_channel_ids text[] not null default '{}',
  post_channel_ids text[] not null default '{}',
  connected_by uuid not null references profiles (id),
  connected_at timestamptz not null default now()
);

-- Every change to a bracket, schedule or result, with who made or approved it.
create table audit_log (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references tournaments (id) on delete cascade,
  actor_id uuid references profiles (id),
  via_agent boolean not null default false,
  action text not null,
  summary text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_by_tournament on audit_log (tournament_id, created_at desc);

-- Host ↔ agent conversation, including proposals awaiting approval.
create table agent_messages (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  role text not null check (role in ('host', 'agent')),
  body text not null,
  proposal jsonb,
  proposal_status text check (proposal_status in ('pending', 'applied', 'dismissed')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reputation and leaderboards
-- ---------------------------------------------------------------------------
create table karma_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles (id) on delete cascade,
  kind karma_kind not null,
  delta int not null,
  reason text not null,
  tournament_id uuid references tournaments (id) on delete set null,
  created_at timestamptz not null default now()
);

create table final_places (
  tournament_id uuid not null references tournaments (id) on delete cascade,
  tournament_team_id uuid not null references tournament_teams (id),
  place int not null check (place between 1 and 3),
  primary key (tournament_id, tournament_team_id)
);

-- Tournaments won, by player and game. A win counts for every player on the
-- winning team, and for the saved roster when the team came from one.
create view player_wins as
  select tp.profile_id, t.game, count(*)::int as wins
  from final_places fp
  join tournaments t on t.id = fp.tournament_id and t.status = 'complete'
  join tournament_players tp on tp.tournament_team_id = fp.tournament_team_id and not tp.is_sub
  where fp.place = 1
  group by tp.profile_id, t.game;

create view team_wins as
  select tt.source_team_id as team_id, t.game, count(*)::int as wins
  from final_places fp
  join tournaments t on t.id = fp.tournament_id and t.status = 'complete'
  join tournament_teams tt on tt.id = fp.tournament_team_id
  where fp.place = 1 and tt.source_team_id is not null
  group by tt.source_team_id, t.game;

-- ---------------------------------------------------------------------------
-- Money. Scheme never holds balances: these rows mirror what the payment
-- provider holds and moves. provider_ref is the provider's id for the object.
-- ---------------------------------------------------------------------------
create table payments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id),
  payer_id uuid not null references profiles (id),
  tournament_team_id uuid references tournament_teams (id),
  amount_cents int not null check (amount_cents > 0),
  platform_fee_cents int not null default 0,
  provider text not null,
  provider_ref text not null unique,
  status payment_status not null default 'pending',
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

create table prizes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  name text not null,
  -- Sent only to the winners.
  claim_instructions text not null default ''
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id),
  tournament_team_id uuid not null references tournament_teams (id),
  profile_id uuid not null references profiles (id),
  place int not null,
  amount_cents int not null check (amount_cents > 0),
  status payout_status not null default 'pending',
  release_at timestamptz not null,
  method text,
  provider_ref text unique,
  claimed_at timestamptz,
  paid_at timestamptz,
  unique (tournament_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
create function is_host(t uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from tournaments where id = t and host_id = auth.uid()) $$;

create function in_tournament(t uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from tournament_players tp
      join tournament_teams tt on tt.id = tp.tournament_team_id
      where tt.tournament_id = t and tp.profile_id = auth.uid()
    ) or exists (select 1 from tournament_entries e where e.tournament_id = t and e.profile_id = auth.uid())
  $$;

create function is_visible(t uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from tournaments where id = t and (status <> 'draft' or host_id = auth.uid())) $$;

alter table profiles enable row level security;
alter table game_accounts enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table tournaments enable row level security;
alter table tournament_teams enable row level security;
alter table tournament_players enable row level security;
alter table tournament_entries enable row level security;
alter table match_results enable row level security;
alter table match_reports enable row level security;
alter table disputes enable row level security;
alter table extension_requests enable row level security;
alter table match_ratings enable row level security;
alter table tickets enable row level security;
alter table ticket_messages enable row level security;
alter table announcements enable row level security;
alter table notifications enable row level security;
alter table discord_connections enable row level security;
alter table audit_log enable row level security;
alter table agent_messages enable row level security;
alter table karma_events enable row level security;
alter table final_places enable row level security;
alter table payments enable row level security;
alter table prizes enable row level security;
alter table payouts enable row level security;

-- Public profile data and linked ranks are visible to signed-in users
-- (players opt in to this when they link an account).
create policy "profiles readable" on profiles for select to authenticated using (true);
create policy "own profile editable" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "game accounts readable" on game_accounts for select to authenticated using (true);

create policy "teams readable" on teams for select to authenticated using (true);
create policy "team members readable" on team_members for select to authenticated using (true);

create policy "visible tournaments" on tournaments for select using (status <> 'draft' or host_id = auth.uid());
create policy "visible tournament teams" on tournament_teams for select using (is_visible(tournament_id));
create policy "visible tournament players" on tournament_players for select using (
  exists (select 1 from tournament_teams tt where tt.id = tournament_team_id and is_visible(tt.tournament_id))
);
create policy "entries for host or self" on tournament_entries for select to authenticated using (profile_id = auth.uid() or is_host(tournament_id));
create policy "visible results" on match_results for select using (is_visible(tournament_id));
create policy "visible announcements" on announcements for select using (is_visible(tournament_id));
create policy "visible final places" on final_places for select using (is_visible(tournament_id));
create policy "visible prizes" on prizes for select using (is_visible(tournament_id));

create policy "reports for participants" on match_reports for select to authenticated using (is_host(tournament_id) or in_tournament(tournament_id));
create policy "disputes for participants" on disputes for select to authenticated using (is_host(tournament_id) or in_tournament(tournament_id));
create policy "extensions for participants" on extension_requests for select to authenticated using (is_host(tournament_id) or in_tournament(tournament_id));
create policy "audit for participants" on audit_log for select to authenticated using (is_host(tournament_id) or in_tournament(tournament_id));
create policy "ratings by rater or host" on match_ratings for select to authenticated using (rater_id = auth.uid() or is_host(tournament_id));

create policy "tickets for opener or host" on tickets for select to authenticated using (opened_by = auth.uid() or is_host(tournament_id));
create policy "ticket messages for opener or host" on ticket_messages for select to authenticated using (
  exists (
    select 1 from tickets t where t.id = ticket_id
    and (is_host(t.tournament_id) or (t.opened_by = auth.uid() and not is_agent_draft))
  )
);

create policy "own notifications" on notifications for select to authenticated using (profile_id = auth.uid());
create policy "mark own notifications read" on notifications for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "discord for host" on discord_connections for select to authenticated using (is_host(tournament_id));
create policy "agent for host" on agent_messages for select to authenticated using (is_host(tournament_id));
create policy "own karma" on karma_events for select to authenticated using (profile_id = auth.uid());

create policy "payments for payer or host" on payments for select to authenticated using (payer_id = auth.uid() or is_host(tournament_id));
create policy "payouts for winner or host" on payouts for select to authenticated using (profile_id = auth.uid() or is_host(tournament_id));

-- Keep updated_at current.
create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger tournaments_touch before update on tournaments for each row execute function touch_updated_at();
