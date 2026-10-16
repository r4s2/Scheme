-- The host can reject a team at check-in. It keeps its bracket spot and
-- forfeits its matches; null means the team is in.
alter table tournament_teams add column rejected_reason text;
