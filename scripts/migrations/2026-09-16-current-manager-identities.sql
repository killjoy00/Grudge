-- Current/future ESPN member -> historical manager identity.
--
-- Historical manager attribution remains commissioner-authored. Starting with
-- 2026, the live ESPN primary owner can create the season manager assignment
-- through this reviewed SWID crosswalk, independently of season results.

begin;

create table if not exists public.manager_espn_members (
  manager_key text not null references public.managers(manager_key),
  swid text not null,
  start_season int not null default 2026 check (start_season between 1900 and 2100),
  end_season int check (end_season between 1900 and 2100),
  primary key (manager_key, swid, start_season),
  check (end_season is null or end_season >= start_season)
);
create unique index if not exists manager_espn_members_active_swid
  on public.manager_espn_members(swid,start_season);

insert into public.manager_espn_members(manager_key,swid,start_season,end_season)
select v.manager_key,v.swid,2026,null::int
  from (values
    ('ryan-mindell','{164FA15F-6CCC-4240-8ED4-940DC77B6F1A}'),
    ('nathan-hanna','{6F8679F7-317A-4DFC-98F4-65FB661DF63E}'),
    ('joe-presley','{4000AA98-F983-11D3-820C-00A0C9E58E2D}'),
    ('michael-chepul','{FCD720A2-C400-4A6A-A063-4AFCD4A994C8}'),
    ('ben-wildfire','{231A183A-FC2C-11D1-9B26-00A0C9862BBB}'),
    ('samuel-nye','{35509590-1CD7-40F0-9580-6E08008E8F07}'),
    ('jonathan-crisp','{E866765C-A1B5-11D2-9B36-00A0C9862BBB}'),
    ('alan-marks','{B2B18A17-9284-492C-93E0-B6A5E65FC5AB}'),
    ('jordan-chin','{C8AA1E68-6333-4545-9A17-1E6B65305BAB}'),
    ('gary-camero','{263AC2DB-973C-437A-9AD6-639EA82FE087}')
  ) as v(manager_key,swid)
  join public.managers m using(manager_key)
on conflict(manager_key,swid,start_season) do update set end_season=excluded.end_season;

alter table public.manager_espn_members enable row level security;
alter table public.manager_espn_members force row level security;
drop policy if exists manager_espn_members_public_read on public.manager_espn_members;
create policy manager_espn_members_public_read on public.manager_espn_members
  for select to authenticated,app_user using(true);
revoke all on public.manager_espn_members from public,authenticated,app_user;
grant select on public.manager_espn_members to authenticated,app_user;
grant select,insert,update,delete on public.manager_espn_members to app_pipeline;

create or replace function public.sync_current_manager_franchise_season()
returns trigger language plpgsql security definer set search_path=public as $$
declare manager text;
declare franchise text;
begin
  if new.season < 2026 then return new; end if;
  select x.manager_key into manager
    from public.manager_espn_members x
   where x.swid=new.swid and new.season>=x.start_season
     and (x.end_season is null or new.season<=x.end_season);
  if manager is null then return new; end if;
  select fst.franchise_key into franchise
    from public.franchise_season_teams fst
   where fst.season=new.season and fst.espn_team_id=new.espn_team_id;
  if franchise is null then return new; end if;
  insert into public.manager_franchise_seasons(season,manager_key,franchise_key,is_primary)
  values(new.season,manager,franchise,new.is_primary)
  on conflict(season,manager_key,franchise_key) do update set is_primary=excluded.is_primary;
  return new;
end $$;

drop trigger if exists team_owners_sync_manager_identity on public.team_owners;
create trigger team_owners_sync_manager_identity
  after insert or update of swid,is_primary,espn_team_id on public.team_owners
  for each row execute function public.sync_current_manager_franchise_season();

-- Populate the live season now from exact team identity + reviewed SWID identity.
insert into public.manager_franchise_seasons(season,manager_key,franchise_key,is_primary)
select o.season,x.manager_key,fst.franchise_key,o.is_primary
  from public.team_owners o
  join public.manager_espn_members x
    on x.swid=o.swid and o.season>=x.start_season
   and (x.end_season is null or o.season<=x.end_season)
  join public.franchise_season_teams fst
    on fst.season=o.season and fst.espn_team_id=o.espn_team_id
 where o.season>=2026
on conflict(season,manager_key,franchise_key) do update set is_primary=excluded.is_primary;

commit;
