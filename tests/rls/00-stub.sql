-- Minimal stand-in for what Neon provides, so the RLS suite runs on a plain
-- local Postgres.
--
-- app.current_user_id() is defined by the schema itself (not here) and prefers
-- the `app.user_id` session setting, falling back to auth.user_id(). This stub
-- supplies only the fallback -- pg_session_jwt's auth.user_id(), which on real
-- Neon resolves a Neon-validated Clerk JWT. Locally it just returns null, which
-- is the correct behavior for a request that carries no JWT.
create schema if not exists auth;

create or replace function auth.user_id() returns text
  language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '') $$;

create role authenticated;
-- The role the web app actually connects as: a member of `authenticated`, so
-- every policy written `to authenticated` applies to it by role membership,
-- and NOT bypassrls.
-- NOT a member of `authenticated`: Neon owns that role and refuses the grant,
-- so policies name both roles explicitly. See the schema doc.
create role app_user;
-- The pipeline role: BYPASSRLS, writes the ESPN mirror + computed tables.
create role app_pipeline with bypassrls;
-- The webhook role: ordinary, non-BYPASSRLS, and only allowed to execute the
-- SECURITY DEFINER provisioning function.
create role app_provisioner;

grant usage   on schema auth            to authenticated, app_user;
grant execute on function auth.user_id() to authenticated, app_user;
