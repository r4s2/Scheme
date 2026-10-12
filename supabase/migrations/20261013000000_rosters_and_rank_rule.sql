-- Team rosters list substitutes, players confirm the teams captains put them
-- on, and a tournament's rank range can be a suggestion instead of a rule.

-- 'open': no range. 'suggested': shown and filterable, not enforced. 'required': enforced at sign-up.
-- Existing events keep the required range they were published with.
alter table tournaments add column rank_rule text not null default 'required'
  check (rank_rule in ('open', 'suggested', 'required'));

-- Most substitutes each team can register on top of its starters.
alter table tournaments add column bench_max int not null default 0 check (bench_max between 0 and 4);

-- Substitutes registered with a team (display only; starters are bench = false),
-- and each player's place in the lineup the captain entered.
alter table tournament_players add column bench boolean not null default false;
alter table tournament_players add column seat int not null default 0;

-- Null once the player has confirmed (and for captains and balanced solo teams).
alter table tournament_players add column confirmation text check (confirmation in ('pending', 'declined'));
