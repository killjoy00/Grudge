-- Baseline grants a Neon project would carry for the `authenticated` role,
-- then the proposal's lockdown on top. Order matters: the blanket grant must
-- come first so the revokes have something to take away.
--
-- Note on redundancy: the schema's own read-only tables (seasons, teams,
-- matchups, etc.) already have RLS FORCEd with no INSERT/UPDATE/DELETE policy
-- at all, so even though this blanket grant re-adds the SQL-level privilege
-- after schema.sql's own revokes ran, Postgres still denies the write --
-- absent any applicable policy, RLS's default for a command is deny. The
-- actual enforcement is RLS having no write policy, not this GRANT dance.
-- The GRANT dance is what matters on `profiles`, where an UPDATE policy DOES
-- exist and RLS has no per-column granularity -- there, the column-level
-- GRANT is the only thing stopping a full-row update.
grant usage on schema public to authenticated, app_user;
grant select, insert, update, delete on all tables in schema public to authenticated, app_user;
grant usage, select on all sequences in schema public to authenticated, app_user;

revoke update on public.profiles from authenticated, app_user;
grant  update (display_name) on public.profiles to authenticated, app_user;

revoke insert, update, delete
  on public.prediction_scores, public.league_allowlist, public.player_ownership_snapshots
  from authenticated, app_user;

do $$ declare t text; begin
  foreach t in array array[
    'seasons','members','teams','team_owners','weeks','players','lineup_slots',
    'matchups','team_week_results','roster_entries','transactions',
    'transaction_items','faab_ledger','power_rankings','luck_index',
    'playoff_odds','weekly_awards'
  ] loop
    execute format('revoke insert, update, delete on public.%I from authenticated, app_user', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ fixtures
insert into public.seasons (season, league_name, team_count, regular_season_weeks,
  playoff_team_count, final_scoring_period, faab_budget, is_current, settings_raw)
values (2026,'UNC Grudge Match',10,14,6,17,100,true,'{}');

insert into public.members (season, swid, display_name) values
  (2026,'{164FA15F-6CCC-4240-8ED4-940DC77B6F1A}','Killjoy00'),
  (2026,'{E35025E4-F300-48D8-9AF1-EEE1911BFD65}','lafleur_81');

-- Non-contiguous team ids on purpose: this league has no team 7.
insert into public.teams (season, espn_team_id, name) values
  (2026,1,'Austin Bubbs'), (2026,6,'P RIVERS NAS NAS'), (2026,11,'Taco MacArthur');

-- Co-ownership: the case a UNIQUE on espn_team_id would have broken.
insert into public.team_owners (season, espn_team_id, swid, is_primary) values
  (2026,1,'{164FA15F-6CCC-4240-8ED4-940DC77B6F1A}',true),
  (2026,1,'{E35025E4-F300-48D8-9AF1-EEE1911BFD65}',false);

-- Week 1 OPEN (kickoff ahead), week 2 LOCKED (kickoff past).
insert into public.weeks (season, week, first_kickoff_at, locks_at, status) values
  (2026,1, now() + interval '3 days', now() + interval '3 days','upcoming'),
  (2026,2, now() - interval '3 days', now() - interval '3 days','final');

insert into public.matchups (season, espn_matchup_id, week, home_team_id, away_team_id) values
  (2026, 1, 1, 6, 1),
  (2026, 2, 1, 11, 1),
  (2026,11, 2, 1, 6);

insert into public.league_allowlist (email, espn_team_id, season, is_admin) values
  ('owner@example.com', 1, 2026, false),
  ('boss@example.com',  6, 2026, true);
