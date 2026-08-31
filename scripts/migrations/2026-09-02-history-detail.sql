-- Top-four finishes on the history tables, and the per-franchise season and
-- manager views the franchise pages need.
--
-- Run once as the Neon database owner, after 2026-09-01-unified-history.sql.
-- Idempotent: a retry is safe.

begin;

-- Adding a column mid-list, so these are dropped rather than replaced; the
-- grants at the foot of the file restore access.
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
       count(*) filter (where fs.final_place <= 4)::int as top_four,
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
       count(*) filter (where fs.final_place <= 4)::int as top_four,
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

-- What each manager did while running one particular franchise. The franchise
-- page credits every win to the franchise and shows this underneath, so a slot
-- that changed hands reads as one record plus its parts.
drop view if exists public.franchise_manager_totals;
create view public.franchise_manager_totals
with (security_invoker = true) as
select ms.franchise_key, m.manager_key, m.display_name,
       count(*)::int as seasons,
       sum(fs.regular_wins)::int as regular_wins,
       sum(fs.regular_losses)::int as regular_losses,
       sum(fs.regular_ties)::int as regular_ties,
       sum(fs.playoff_wins)::int as playoff_wins,
       sum(fs.playoff_losses)::int as playoff_losses,
       count(*) filter (where fs.is_champion)::int as championships,
       count(*) filter (where fs.final_place <= 4)::int as top_four,
       count(*) filter (where fs.playoff_wins + fs.playoff_losses > 0)::int
         as playoff_appearances,
       sum(fs.regular_points_for) as regular_points_for,
       min(ms.season)::int as first_season,
       max(ms.season)::int as last_season
  from public.manager_franchise_seasons ms
  join public.managers m using (manager_key)
  join public.franchise_seasons fs
    on fs.season = ms.season and fs.franchise_key = ms.franchise_key
 group by ms.franchise_key, m.manager_key, m.display_name;

grant select on public.franchise_history_totals, public.manager_history_totals,
                public.franchise_manager_totals
  to authenticated, app_user;

commit;
