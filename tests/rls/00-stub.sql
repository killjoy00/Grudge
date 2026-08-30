-- Minimal stand-in for the parts of Supabase the schema depends on, so the RLS
-- suite can run against a plain local Postgres. Mirrors the grants Supabase
-- actually makes, so a test result here means the same thing in production.
create schema if not exists auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Supabase reads the signed JWT; locally we drive it from a session GUC.
create or replace function auth.uid() returns uuid
  language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create role anon;
create role authenticated;
create role service_role;

grant usage   on schema auth        to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
grant select  on auth.users          to authenticated;
