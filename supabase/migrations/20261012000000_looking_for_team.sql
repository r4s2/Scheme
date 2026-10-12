-- Players can mark themselves as looking for a team, so captains can find
-- recruits on the Teams page.
alter table profiles add column looking_for_team boolean not null default false;
