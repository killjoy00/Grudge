-- Canonical identity cleanup.
--
-- 1. Franchise-season identity exists independently of settled results.
-- 2. team_franchise resolves only an exact season/team mapping; it never infers
--    identity from a previous season's ESPN team id.
-- 3. nfl_players.player_key is the application player identity. ESPN ids remain
--    source-system keys bridged through nfl_player_aliases / player_identity.
-- 4. Existing player_week_scores keys are normalized and constrained.
--
-- Apply as the database owner. The migration is written so a retry after a
-- partial deployment is safe.

begin;

-- Views depending on the old combined franchise_seasons table must be removed
-- before the table can be renamed. They are recreated below on canonical data.
drop view if exists public.team_franchise;
drop view if exists public.season_champions;
drop view if exists public.franchise_manager_totals;
drop view if exists public.manager_history_totals;
drop view if exists public.franchise_history_totals;

-- --------------------------------------------------------- season identity

create table if not exists public.franchise_season_teams (
  season        int not null check (season between 1900 and 2100),
  franchise_key text not null references public.franchises(franchise_key),
  espn_team_id  int,
  team_name     text not null,
  primary key (season, franchise_key),
  unique (season, espn_team_id)
);

-- On the first run the old table still owns team_name + espn_team_id. Copy
-- those identities before renaming it. On retries the compatibility view has
-- the same columns and remains a valid source.
insert into public.franchise_season_teams (season, franchise_key, espn_team_id, team_name)
select season, franchise_key, espn_team_id, team_name
  from public.franchise_seasons
on conflict (season, franchise_key) do update set
  espn_team_id = excluded.espn_team_id,
  team_name = excluded.team_name;

-- 2026 has live ESPN teams but no settled season results yet. These are explicit
-- mappings from data/manual-history/espn-franchises.csv, not an id fallback.
insert into public.franchise_season_teams (season, franchise_key, espn_team_id, team_name)
select 2026, mapping.franchise_key, mapping.espn_team_id, t.name
  from (values
    ('bubbs', 1),
    ('run-and-hide', 2),
    ('your-worst-nightmares', 3),
    ('the-penguins', 4),
    ('penthouse-panda-bear', 5),
    ('p-rivers-nas-nas', 6),
    ('brightleaf-yuppies', 8),
    ('raleigh-silly-nannies', 9),
    ('cte-deniers', 10),
    ('taco-macarthur', 11)
  ) as mapping(franchise_key, espn_team_id)
  join public.teams t
    on t.season = 2026 and t.espn_team_id = mapping.espn_team_id
on conflict (season, franchise_key) do update set
  espn_team_id = excluded.espn_team_id,
  team_name = excluded.team_name;

alter table public.franchise_season_teams enable row level security;
alter table public.franchise_season_teams force row level security;
drop policy if exists franchise_season_teams_public_read on public.franchise_season_teams;
create policy franchise_season_teams_public_read on public.franchise_season_teams
  for select to authenticated, app_user using (true);
revoke all on public.franchise_season_teams from public, authenticated, app_user;
grant select on public.franchise_season_teams to authenticated, app_user;
grant select, insert, update, delete on public.franchise_season_teams to app_pipeline;

-- ---------------------------------------------------------- season results

alter table public.manager_franchise_seasons
  drop constraint if exists manager_franchise_seasons_season_franchise_key_fkey;

-- Rename the physical table only once. pg_class.relkind='r' distinguishes the
-- original table from the compatibility view created later in this migration.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'franchise_seasons' and c.relkind = 'r'
  ) and to_regclass('public.franchise_season_results') is null then
    alter table public.franchise_seasons rename to franchise_season_results;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='franchise_season_results' and column_name='team_name'
  ) then
    alter table public.franchise_season_results drop column team_name;
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='franchise_season_results' and column_name='espn_team_id'
  ) then
    alter table public.franchise_season_results drop column espn_team_id;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='franchise_season_results_team_fkey') then
    alter table public.franchise_season_results
      add constraint franchise_season_results_team_fkey
      foreign key (season, franchise_key)
      references public.franchise_season_teams(season, franchise_key) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='manager_franchise_seasons_team_fkey') then
    alter table public.manager_franchise_seasons
      add constraint manager_franchise_seasons_team_fkey
      foreign key (season, franchise_key)
      references public.franchise_season_teams(season, franchise_key) on delete cascade;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='franchise_season_results'
       and policyname='franchise_seasons_public_read'
  ) then
    alter policy franchise_seasons_public_read on public.franchise_season_results
      rename to franchise_season_results_public_read;
  end if;
end $$;

-- Temporary compatibility surface for result-centric code. New identity joins
-- should use franchise_season_teams directly. This view is deliberately read-only.
create or replace view public.franchise_seasons with (security_invoker = true) as
select r.season, r.franchise_key, t.team_name, t.espn_team_id,
       r.regular_wins, r.regular_losses, r.regular_ties,
       r.regular_points_for, r.regular_points_against,
       r.playoff_wins, r.playoff_losses, r.final_place,
       r.is_champion, r.is_runner_up, r.source, r.source_note
  from public.franchise_season_results r
  join public.franchise_season_teams t using (season, franchise_key);

grant select on public.franchise_seasons to authenticated, app_user, app_pipeline;

-- No previous-season fallback. A null franchise_key is intentional evidence
-- that a season/team has not been explicitly mapped yet.
create or replace view public.team_franchise with (security_invoker = true) as
select t.season, t.espn_team_id, t.name as team_name, fst.franchise_key
  from public.teams t
  left join public.franchise_season_teams fst
    on fst.season = t.season and fst.espn_team_id = t.espn_team_id;

grant select on public.team_franchise to authenticated, app_user, app_pipeline;
comment on view public.team_franchise is
  'Exact season ESPN team -> durable franchise identity. Never falls back to another season.';

-- ------------------------------------------------------------ history views

create or replace view public.franchise_history_totals
with (security_invoker = true) as
select f.franchise_key, f.current_name,
       latest.espn_team_id,
       count(r.season)::int as seasons,
       sum(r.regular_wins)::int as regular_wins,
       sum(r.regular_losses)::int as regular_losses,
       sum(r.regular_ties)::int as regular_ties,
       sum(r.playoff_wins)::int as playoff_wins,
       sum(r.playoff_losses)::int as playoff_losses,
       count(*) filter (where r.is_champion)::int as championships,
       count(*) filter (where r.is_runner_up)::int as runner_ups,
       count(*) filter (where r.final_place <= 4)::int as top_four,
       count(*) filter (where (r.playoff_wins + r.playoff_losses) > 0)::int as playoff_appearances,
       string_agg(r.season::text, ' ' order by r.season) filter (where r.is_champion) as title_seasons,
       sum(r.regular_points_for) as regular_points_for,
       sum(r.regular_points_against) as regular_points_against,
       min(r.season)::int as first_season,
       max(r.season)::int as last_season
  from public.franchises f
  join public.franchise_season_results r using (franchise_key)
  left join lateral (
    select t.espn_team_id
      from public.franchise_season_teams t
     where t.franchise_key = f.franchise_key and t.espn_team_id is not null
     order by t.season desc
     limit 1
  ) latest on true
 group by f.franchise_key, f.current_name, latest.espn_team_id;

create or replace view public.manager_history_totals
with (security_invoker = true) as
select m.manager_key, m.display_name,
       count(distinct ms.season)::int as seasons,
       sum(r.regular_wins)::int as regular_wins,
       sum(r.regular_losses)::int as regular_losses,
       sum(r.regular_ties)::int as regular_ties,
       sum(r.playoff_wins)::int as playoff_wins,
       sum(r.playoff_losses)::int as playoff_losses,
       count(*) filter (where r.is_champion)::int as championships,
       count(*) filter (where r.is_runner_up)::int as runner_ups,
       count(*) filter (where r.final_place <= 4)::int as top_four,
       count(*) filter (where (r.playoff_wins + r.playoff_losses) > 0)::int as playoff_appearances,
       string_agg(r.season::text, ' ' order by r.season) filter (where r.is_champion) as title_seasons,
       sum(r.regular_points_for) as regular_points_for,
       min(ms.season)::int as first_season,
       max(ms.season)::int as last_season
  from public.managers m
  join public.manager_franchise_seasons ms using (manager_key)
  join public.franchise_season_results r
    on r.season = ms.season and r.franchise_key = ms.franchise_key
 group by m.manager_key, m.display_name;

create or replace view public.franchise_manager_totals
with (security_invoker = true) as
select ms.franchise_key, m.manager_key, m.display_name,
       count(*)::int as seasons,
       sum(r.regular_wins)::int as regular_wins,
       sum(r.regular_losses)::int as regular_losses,
       sum(r.regular_ties)::int as regular_ties,
       sum(r.playoff_wins)::int as playoff_wins,
       sum(r.playoff_losses)::int as playoff_losses,
       count(*) filter (where r.is_champion)::int as championships,
       count(*) filter (where r.final_place <= 4)::int as top_four,
       count(*) filter (where (r.playoff_wins + r.playoff_losses) > 0)::int as playoff_appearances,
       sum(r.regular_points_for) as regular_points_for,
       min(ms.season)::int as first_season,
       max(ms.season)::int as last_season
  from public.manager_franchise_seasons ms
  join public.managers m using (manager_key)
  join public.franchise_season_results r
    on r.season = ms.season and r.franchise_key = ms.franchise_key
 group by ms.franchise_key, m.manager_key, m.display_name;

create or replace view public.season_champions
with (security_invoker = true) as
select r.season,
       max(r.franchise_key) filter (where r.is_champion) as champion_key,
       max(f.current_name) filter (where r.is_champion) as champion_name,
       max(t.team_name) filter (where r.is_champion) as champion_team_name,
       max(r.franchise_key) filter (where r.is_runner_up) as runner_up_key,
       max(f.current_name) filter (where r.is_runner_up) as runner_up_name,
       max(r.source) as source,
       count(*)::int as teams
  from public.franchise_season_results r
  join public.franchises f using (franchise_key)
  join public.franchise_season_teams t using (season, franchise_key)
 group by r.season;

grant select on public.franchise_history_totals, public.manager_history_totals,
  public.franchise_manager_totals, public.season_champions
  to authenticated, app_user;

-- ------------------------------------------------------------- player identity

-- Application queries with a season and ESPN source id can use this bridge for
-- the canonical player key/name while legacy provider metadata remains available
-- during the gradual migration away from public.players.
create or replace view public.player_identity with (security_invoker = true) as
select a.season, a.espn_player_id, a.player_key, np.full_name,
       coalesce(psp.position_id, legacy.default_position_id) as position_id,
       coalesce(psp.eligible_slots, legacy.eligible_slots) as eligible_slots
  from public.nfl_player_aliases a
  join public.nfl_players np using (player_key)
  left join public.player_season_profiles psp
    on psp.season = a.season and psp.espn_player_id = a.espn_player_id
  left join public.players legacy on legacy.espn_player_id = a.espn_player_id;

grant select on public.player_identity to authenticated, app_user, app_pipeline;

-- Replace old `espn:<id>` scoring keys (notably D/ST) with the exact season alias.
-- The current production data has no collisions for this rewrite.
update public.player_week_scores pws
   set player_key = a.player_key
  from public.nfl_player_aliases a
 where a.season = pws.season
   and a.espn_player_id = pws.espn_player_id
   and pws.player_key is distinct from a.player_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='player_week_scores_player_key_fkey') then
    alter table public.player_week_scores
      add constraint player_week_scores_player_key_fkey
      foreign key (player_key) references public.nfl_players(player_key);
  end if;
end $$;

comment on column public.player_week_scores.player_key is
  'Canonical nfl_players.player_key. ESPN ids are source aliases, not application identity.';

commit;
