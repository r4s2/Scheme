-- Local development seed: one host, 40 players, and a live 8-team Valorant
-- event with two results in. Mirrors "Friday Night Spike" from the prototype.
-- Ids are deterministic so tests and links stay stable across resets.

create or replace function seed_uuid(label text) returns uuid language sql immutable as $$
  select (substr(md5(label), 1, 8) || '-' || substr(md5(label), 9, 4) || '-4' || substr(md5(label), 14, 3) || '-8' || substr(md5(label), 18, 3) || '-' || substr(md5(label), 21, 12))::uuid
$$;

-- People
insert into auth.users (id, email)
select seed_uuid('user:' || h), h || '@example.test'
from unnest(array['kestrel','ember','vexa','moth','kiro','tallulah','vanta','sundew','ozzy','pixelwitch','b0lt','harbor','juno','ketchup','ruin','nimbus','pebble','quokka','dandelion','fizz','grit','sable','lumen','cobra','wren','tofu','quill','staticc','haze','rook','zephyr','glint','crumb','delta','iris','koi','lynx','mint','nox','pyre','orbitz']) as h;

insert into profiles (id, handle, attested_13_plus, verified_18_plus, player_karma, host_karma)
select seed_uuid('user:' || h), h, true, true, 80 + (length(h) % 15), 90
from unnest(array['kestrel','ember','vexa','moth','kiro','tallulah','vanta','sundew','ozzy','pixelwitch','b0lt','harbor','juno','ketchup','ruin','nimbus','pebble','quokka','dandelion','fizz','grit','sable','lumen','cobra','wren','tofu','quill','staticc','haze','rook','zephyr','glint','crumb','delta','iris','koi','lynx','mint','nox','pyre','orbitz']) as h;

-- Event
insert into tournaments (id, host_id, name, game, format, best_of, signup_type, status, region, team_count, roles,
                         rank_min_score, rank_max_score, starts_at, match_window_hours, house_rules)
values (seed_uuid('t:fns'), seed_uuid('user:kestrel'), 'Friday Night Spike', 'val', 'single', 3, 'team', 'live', 'NA East', 8,
        '{Duelist,Initiator,Controller,Sentinel,Flex}', 6, 23, now() - interval '3 hours', 24,
        '{"Overtime: win by two, no cap.","Screenshot the final scoreboard of every map."}');

with t(name, ord, rank) as (
  values ('Tilt Proof', 0, 19), ('Eco Round', 1, 11), ('Night Shift', 2, 16), ('Paper Tigers', 3, 13),
         ('Low Ground', 4, 18), ('Second Wind', 5, 14), ('Hot Coffee', 6, 17), ('Backline Bandits', 7, 15)
), handles as (
  select h, row_number() over () - 1 as i
  from unnest(array['ember','vexa','moth','kiro','tallulah','vanta','sundew','ozzy','pixelwitch','b0lt','harbor','juno','ketchup','ruin','nimbus','pebble','quokka','dandelion','fizz','grit','sable','lumen','cobra','wren','tofu','quill','staticc','haze','rook','zephyr','glint','crumb','delta','iris','koi','lynx','mint','nox','pyre','orbitz']) as h
), ins_teams as (
  insert into tournament_teams (id, tournament_id, name, captain_id)
  select seed_uuid('tt:' || t.name), seed_uuid('t:fns'), t.name,
         seed_uuid('user:' || (select h from handles where i = t.ord * 5))
  from t
  returning id
)
insert into tournament_players (tournament_team_id, profile_id, role, rank_score, rank_source, checked_in_at)
select seed_uuid('tt:' || t.name), seed_uuid('user:' || h.h),
       (array['Duelist','Initiator','Controller','Sentinel','Flex'])[(h.i % 5) + 1],
       t.rank + (array[2,0,1,-1,-2])[(h.i % 5) + 1], 'api', now() - interval '3 hours'
from t join handles h on h.i / 5 = t.ord;

insert into game_accounts (profile_id, game, external_id, account_name, rank_score, roles, rank_source, verified_at)
select tp.profile_id, 'val', 'puuid-' || p.handle, p.handle || '#NA1', tp.rank_score, array[tp.role], 'api', now()
from tournament_players tp join profiles p on p.id = tp.profile_id;

update tournaments set
  slots = array(select seed_uuid('tt:' || n) from unnest(array['Tilt Proof','Eco Round','Night Shift','Paper Tigers','Low Ground','Second Wind','Hot Coffee','Backline Bandits']) with ordinality as x(n, o) order by o),
  wave_deadlines = array[now() + interval '3 hours', now() + interval '27 hours', now() + interval '51 hours']
where id = seed_uuid('t:fns');

-- Results. result_key is the two team ids sorted by code point ("C" collation),
-- matching pairKey() in src/engine/bracket.ts.
insert into match_results (tournament_id, result_key, match_id, winner_team_id, w, l, source)
select seed_uuid('t:fns'),
       least(seed_uuid('tt:' || a)::text collate "C", seed_uuid('tt:' || b)::text collate "C") || '|' ||
       greatest(seed_uuid('tt:' || a)::text collate "C", seed_uuid('tt:' || b)::text collate "C"),
       m, seed_uuid('tt:' || a), w, l, 'reports'
from (values ('M1', 'Tilt Proof', 'Eco Round', 2, 0), ('M3', 'Low Ground', 'Second Wind', 2, 1)) as r(m, a, b, w, l);

insert into notifications (profile_id, kind, body, link)
values (seed_uuid('user:kestrel'), 'extension_request', 'Hot Coffee asked for 1 more hour on M4 in Friday Night Spike.', '/t/' || seed_uuid('t:fns'));

insert into audit_log (tournament_id, actor_id, action, summary)
values (seed_uuid('t:fns'), seed_uuid('user:kestrel'), 'bracket.publish', 'Published the bracket (single elimination, 8 teams).');

drop function seed_uuid(text);
