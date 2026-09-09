-- Durable provider-to-franchise crosswalk.
--
-- This is the database copy of data/manual-history/espn-franchises.csv. It is
-- explicit identity data, not a fallback: a team maps only when its season falls
-- inside a reviewed range for that exact ESPN team id.

begin;

create table if not exists public.franchise_espn_team_ranges (
  franchise_key text not null references public.franchises(franchise_key),
  espn_team_id int not null,
  start_season int not null check (start_season between 1900 and 2100),
  end_season int check (end_season between 1900 and 2100),
  notes text,
  primary key (franchise_key, espn_team_id, start_season),
  check (end_season is null or end_season >= start_season)
);

insert into public.franchise_espn_team_ranges
  (franchise_key, espn_team_id, start_season, end_season, notes)
values
  ('bubbs', 1, 2005, null, 'Austin Bubbs lineage'),
  ('run-and-hide', 2, 2005, null, 'Run and Hide lineage'),
  ('your-worst-nightmares', 3, 2005, null, 'Your Worst Nightmares lineage'),
  ('the-penguins', 4, 2005, null, 'The Penguins lineage'),
  ('penthouse-panda-bear', 5, 2005, null, 'Penthouse Panda Bear lineage'),
  ('p-rivers-nas-nas', 6, 2005, null, 'P RIVERS NAS NAS lineage'),
  ('brightleaf-yuppies', 8, 2005, null, 'Brightleaf Yuppies lineage'),
  ('cte-deniers', 7, 2005, 2005, 'Verified raw ESPN id in inaugural season'),
  ('raleigh-silly-nannies', 9, 2006, null, 'Raleigh franchise joined in 2006'),
  ('cte-deniers', 10, 2006, null, 'CTE lineage after 2005 team-id handoff'),
  ('taco-macarthur', 11, 2006, null, 'Taco franchise joined in 2006')
on conflict (franchise_key, espn_team_id, start_season) do update set
  end_season = excluded.end_season,
  notes = excluded.notes;

alter table public.franchise_espn_team_ranges enable row level security;
alter table public.franchise_espn_team_ranges force row level security;
drop policy if exists franchise_espn_team_ranges_public_read on public.franchise_espn_team_ranges;
create policy franchise_espn_team_ranges_public_read on public.franchise_espn_team_ranges
  for select to authenticated, app_user using (true);
revoke all on public.franchise_espn_team_ranges from public, authenticated, app_user;
grant select on public.franchise_espn_team_ranges to authenticated, app_user;
grant select, insert, update, delete on public.franchise_espn_team_ranges to app_pipeline;

-- Refuse overlapping ranges for the same ESPN id. If ESPN ever reuses an id,
-- close the old range and add a new explicit row for the new franchise.
create or replace function public.enforce_franchise_espn_range_overlap()
returns trigger language plpgsql
set search_path = public as $$
begin
  if exists (
    select 1
      from public.franchise_espn_team_ranges r
     where r.espn_team_id = new.espn_team_id
       and (r.franchise_key, r.espn_team_id, r.start_season)
           <> (new.franchise_key, new.espn_team_id, new.start_season)
       and int4range(r.start_season, coalesce(r.end_season + 1, 2101), '[)')
           && int4range(new.start_season, coalesce(new.end_season + 1, 2101), '[)')
  ) then
    raise exception 'ESPN team id % has overlapping franchise identity ranges', new.espn_team_id
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists franchise_espn_ranges_no_overlap on public.franchise_espn_team_ranges;
create trigger franchise_espn_ranges_no_overlap
  before insert or update on public.franchise_espn_team_ranges
  for each row execute function public.enforce_franchise_espn_range_overlap();

-- Exact-season mapper used both for the initial backfill and future weekly team
-- writes. It never consults a previous season.
create or replace function public.sync_franchise_season_team()
returns trigger language plpgsql
security definer set search_path = public as $$
declare mapped text;
begin
  select r.franchise_key into mapped
    from public.franchise_espn_team_ranges r
   where r.espn_team_id = new.espn_team_id
     and new.season >= r.start_season
     and (r.end_season is null or new.season <= r.end_season);

  if mapped is null then
    return new;
  end if;

  insert into public.franchise_season_teams
    (season, franchise_key, espn_team_id, team_name)
  values (new.season, mapped, new.espn_team_id, new.name)
  on conflict (season, franchise_key) do update set
    espn_team_id = excluded.espn_team_id,
    team_name = excluded.team_name;
  return new;
end $$;

drop trigger if exists teams_sync_franchise_identity on public.teams;
create trigger teams_sync_franchise_identity
  after insert or update of name, espn_team_id on public.teams
  for each row execute function public.sync_franchise_season_team();

-- Backfill every stored ESPN season using only the reviewed ranges.
insert into public.franchise_season_teams
  (season, franchise_key, espn_team_id, team_name)
select t.season, r.franchise_key, t.espn_team_id, t.name
  from public.teams t
  join public.franchise_espn_team_ranges r
    on r.espn_team_id = t.espn_team_id
   and t.season >= r.start_season
   and (r.end_season is null or t.season <= r.end_season)
on conflict (season, franchise_key) do update set
  espn_team_id = excluded.espn_team_id,
  team_name = excluded.team_name;

commit;
