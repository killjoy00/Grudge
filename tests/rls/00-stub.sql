-- Minimal stand-in for the parts of Neon + Neon RLS Authorize the schema
-- depends on, so the RLS suite can run against a plain local Postgres.
--
-- Unlike the earlier Supabase-shaped stub, there is no auth.users table here:
-- Clerk owns user identity outside Postgres entirely, so this schema has
-- nothing to mirror for it. What Neon RLS Authorize actually provides is a
-- single function, auth.user_id() -- confirmed from Neon's own docs
-- (neon.com/docs/guides/rls-tutorial) -- which resolves the caller's identity
-- from a verified JWT (via the pg_session_jwt extension). Locally we drive
-- that same function from a session GUC, exactly as the Supabase stub drove
-- auth.uid() -- same simulation technique, different function being simulated.
--
-- Return type: assumed text, matching Clerk's string-shaped user IDs
-- (e.g. "user_2abc..."). Flagged as unverified in docs/SCHEMA_PROPOSAL.md;
-- if Neon's real function returns something else, this stub and the schema's
-- profiles.id / *.user_id columns need a matching, small adjustment.
-- app_pipeline (the BYPASSRLS pipeline role) is NOT created here: it's created
-- by the schema proposal's own SQL block (docs/SCHEMA_PROPOSAL.md, "Shape of
-- the design"), same as it would be in a real migration. Creating it twice
-- would conflict. It needs no grant on schema auth either -- it's a direct
-- Postgres connection string, never a Clerk JWT, so it never calls
-- auth.user_id() at all.
create schema if not exists auth;

create or replace function auth.user_id() returns text
  language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '') $$;

create role authenticated;

grant usage   on schema auth            to authenticated;
grant execute on function auth.user_id() to authenticated;
