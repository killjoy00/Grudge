-- The server-side weekly recap pipeline must confirm that an opted-in profile
-- still has an active league membership before emailing it. Keep the private
-- allowlist closed to app_pipeline generally; grant only the two columns needed
-- for that membership test.

begin;

grant select (email, is_active)
  on public.league_allowlist to app_pipeline;

commit;
