-- Minimal stand-ins for what Supabase provides, so the migrations and seed
-- can run on plain Postgres in CI. Never apply this to a Supabase project.
create role authenticated;
create role anon;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
