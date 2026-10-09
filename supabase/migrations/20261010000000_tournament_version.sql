-- Optimistic locking for tournament operations: every save checks the version
-- it loaded and bumps it, so two hosts (or the host and a background job)
-- can't silently overwrite each other's changes.
alter table tournaments add column version int not null default 0;
