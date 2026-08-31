-- One league record across both eras.
--
-- franchise_seasons now carries 2005-2017 (source 'manual', transcribed from
-- the commissioner's spreadsheet) and 2018 onward (source 'espn', derived from
-- the archived league.json), so the totals views below stop being a pre-ESPN
-- curiosity and become the league's all-time record.
--
-- Run once as the Neon database owner, after
-- 2026-08-31-membership-recaps-history.sql. Idempotent: a retry is safe.

begin;

-- Championship years read better than a bare count, and the history page shows
-- them inline. Aggregated here so the page never fans out a query per row.
--
-- Dropped rather than replaced: `create or replace view` cannot add a column
-- anywhere but the end, and these gain espn_team_id in the middle. Nothing in
-- the database depends on them -- the app selects them by name -- so the drop
-- is safe, and the grants at the foot of this file restore access.
drop view if exists public.franchise_history_totals;
create view public.franchise_history_totals
with (security_invoker = true) as
select f.franchise_key, f.current_name,
       max(fs.espn_team_id) filter (where fs.source = 'espn') as espn_team_id,
       count(fs.season)::int as seasons,
       sum(fs.regular_wins)::int as regular_wins,
       sum(fs.regular_losses)::int as regular_losses,
       sum(fs.regular_ties)::int as regular_ties,
       sum(fs.playoff_wins)::int as playoff_wins,
       sum(fs.playoff_losses)::int as playoff_losses,
       count(*) filter (where fs.is_champion)::int as championships,
       count(*) filter (where fs.is_runner_up)::int as runner_ups,
       count(*) filter (where fs.playoff_wins + fs.playoff_losses > 0)::int
         as playoff_appearances,
       string_agg(fs.season::text, ' ' order by fs.season)
         filter (where fs.is_champion) as title_seasons,
       sum(fs.regular_points_for) as regular_points_for,
       sum(fs.regular_points_against) as regular_points_against,
       min(fs.season)::int as first_season,
       max(fs.season)::int as last_season
  from public.franchises f
  join public.franchise_seasons fs using (franchise_key)
 group by f.franchise_key, f.current_name;

drop view if exists public.manager_history_totals;
create view public.manager_history_totals
with (security_invoker = true) as
select m.manager_key, m.display_name,
       count(distinct ms.season)::int as seasons,
       sum(fs.regular_wins)::int as regular_wins,
       sum(fs.regular_losses)::int as regular_losses,
       sum(fs.regular_ties)::int as regular_ties,
       sum(fs.playoff_wins)::int as playoff_wins,
       sum(fs.playoff_losses)::int as playoff_losses,
       count(*) filter (where fs.is_champion)::int as championships,
       count(*) filter (where fs.is_runner_up)::int as runner_ups,
       count(*) filter (where fs.playoff_wins + fs.playoff_losses > 0)::int
         as playoff_appearances,
       string_agg(fs.season::text, ' ' order by fs.season)
         filter (where fs.is_champion) as title_seasons,
       sum(fs.regular_points_for) as regular_points_for,
       min(ms.season)::int as first_season,
       max(ms.season)::int as last_season
  from public.managers m
  join public.manager_franchise_seasons ms using (manager_key)
  join public.franchise_seasons fs
    on fs.season = ms.season and fs.franchise_key = ms.franchise_key
 group by m.manager_key, m.display_name;

-- Every season the league actually played, champion included. The history page
-- uses it for the title roll; /standings still owns the week-by-week ESPN data.
drop view if exists public.season_champions;
create view public.season_champions
with (security_invoker = true) as
select fs.season,
       max(fs.franchise_key) filter (where fs.is_champion) as champion_key,
       max(f.current_name) filter (where fs.is_champion) as champion_name,
       max(fs.team_name) filter (where fs.is_champion) as champion_team_name,
       max(fs.franchise_key) filter (where fs.is_runner_up) as runner_up_key,
       max(f.current_name) filter (where fs.is_runner_up) as runner_up_name,
       max(fs.source) as source,
       count(*)::int as teams
  from public.franchise_seasons fs
  join public.franchises f using (franchise_key)
 group by fs.season;

grant select on public.franchise_history_totals, public.manager_history_totals,
                public.season_champions
  to authenticated, app_user;

commit;
