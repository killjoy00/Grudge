-- Membership administration, member-controlled recap preferences, recap send
-- history, and the identity-safe foundation for pre-ESPN history.
--
-- Run once as the Neon database owner. The script is intentionally idempotent
-- so a retry after a network interruption is safe.

begin;

-- ---------------------------------------------------------------- membership

alter table public.league_allowlist
  add column if not exists is_active boolean not null default true;

alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists recap_email_enabled boolean not null default true;

-- This is the membership gate used by the web connection before it sets a
-- request identity. It deliberately joins the two records: a stale profile can
-- never preserve access after an administrator deactivates the allowlist row.
create or replace function public.profile_is_active(p_user_id text)
returns boolean
language sql stable security definer
set search_path = public as $$
  select coalesce((
    select p.is_active and a.is_active
      from public.profiles p
      join public.league_allowlist a on a.email = p.email
     where p.id = p_user_id
  ), false);
$$;

revoke all on function public.profile_is_active(text) from public;
grant execute on function public.profile_is_active(text) to authenticated, app_user;

-- Admin authority now follows the active allowlist row. profiles.is_admin is
-- retained as a useful denormalized display field, but a failed profile refresh
-- can neither preserve a demotion nor prematurely grant a promotion.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, app as $$
  select coalesce((
    select a.is_admin
      from public.profiles p
      join public.league_allowlist a on a.email = p.email and a.is_active
     where p.id = app.current_user_id() and p.is_active
  ), false);
$$;

-- Users may change only their own display preference fields. The trigger is a
-- second line of defence if a future migration accidentally widens the grant.
create or replace function public.prevent_profile_escalation()
returns trigger language plpgsql security definer
set search_path = public, auth as $$
begin
  if app.current_user_id() is not null and (
       new.is_admin     is distinct from old.is_admin
    or new.is_active    is distinct from old.is_active
    or new.espn_team_id is distinct from old.espn_team_id
    or new.espn_swid    is distinct from old.espn_swid
    or new.email        is distinct from old.email) then
    raise exception 'cannot modify privileged profile columns' using errcode = '42501';
  end if;
  return new;
end $$;

revoke update on public.profiles from authenticated, app_user;
grant update (display_name, recap_email_enabled)
  on public.profiles to authenticated, app_user;

-- Active admins can manage membership rows. Database RLS remains authoritative
-- even if a future route forgets its server-side administrator check.
drop policy if exists allowlist_admin_manage on public.league_allowlist;
create policy allowlist_admin_manage on public.league_allowlist
  for all to authenticated, app_user
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.league_allowlist to authenticated, app_user;

-- Prevent the UI (or a direct SQL call through the app role) from deactivating
-- or demoting the last active commissioner and locking the league out.
create or replace function public.prevent_last_active_admin()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if old.is_admin and old.is_active
     and (tg_op = 'DELETE' or not new.is_admin or not new.is_active)
     and not exists (
    select 1 from public.league_allowlist other
     where other.email <> old.email and other.is_admin and other.is_active
  ) then
    raise exception 'cannot remove the last active administrator' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists allowlist_keep_one_admin on public.league_allowlist;
create trigger allowlist_keep_one_admin
  before update or delete on public.league_allowlist
  for each row execute function public.prevent_last_active_admin();

-- Clerk's webhook remains the only creator of profile rows. Replaying a
-- user.updated event also refreshes team/admin/active membership while keeping
-- a display name the member customized on /me.
create or replace function public.provision_profile(
  p_clerk_user_id text, p_email citext, p_display_name text default null
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare a public.league_allowlist%rowtype;
declare result public.profiles;
begin
  select * into a
    from public.league_allowlist
   where email = lower(p_email) and is_active;
  if not found then
    raise exception 'Email % is not on the active league allowlist', p_email
      using errcode = '42501';
  end if;

  insert into public.profiles
    (id, email, espn_swid, espn_team_id, is_admin, is_active, display_name)
  values
    (p_clerk_user_id, lower(p_email), a.espn_swid, a.espn_team_id,
     a.is_admin, true, coalesce(p_display_name, split_part(p_email, '@', 1)))
  on conflict (id) do update set
    email        = excluded.email,
    espn_swid    = excluded.espn_swid,
    espn_team_id = excluded.espn_team_id,
    is_admin     = excluded.is_admin,
    is_active    = true,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    updated_at   = now()
  returning * into result;

  update public.league_allowlist set claimed_at = now() where email = lower(p_email);
  return result;
end $$;

-- After an administrator edits a membership row, this narrow provisioner-only
-- function refreshes an existing profile. It does not create users or alter the
-- allowlist, and deactivation is immediate at the authoritative allowlist gate
-- even if this cosmetic denormalization refresh has to be retried.
create or replace function public.sync_profile_membership(p_email citext)
returns void
language plpgsql security definer set search_path = public as $$
declare a public.league_allowlist%rowtype;
begin
  select * into a from public.league_allowlist where email = lower(p_email);
  if not found then
    update public.profiles set is_active = false, updated_at = now()
     where email = lower(p_email);
    return;
  end if;

  update public.profiles set
    espn_swid = a.espn_swid,
    espn_team_id = a.espn_team_id,
    is_admin = a.is_admin,
    is_active = a.is_active,
    updated_at = now()
  where email = a.email;
end $$;

revoke all on function public.provision_profile(text, citext, text)
  from public, authenticated, app_user, app_pipeline;
revoke all on function public.sync_profile_membership(citext)
  from public, authenticated, app_user, app_pipeline;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_provisioner') then
    execute 'revoke all on function public.provision_profile(text, citext, text) from app_provisioner';
    execute 'revoke all on function public.sync_profile_membership(citext) from app_provisioner';
    execute 'grant execute on function public.provision_profile(text, citext, text) to app_provisioner';
    execute 'grant execute on function public.sync_profile_membership(citext) to app_provisioner';
  end if;
end $$;

-- ----------------------------------------------------------- recap history

create table if not exists public.recap_deliveries (
  id                  bigserial primary key,
  season              int not null,
  week                int not null,
  profile_id          text references public.profiles(id) on delete set null,
  recipient_email     citext not null,
  status              text not null
                        check (status in ('sending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error_code          text,
  attempt_count       int not null default 0 check (attempt_count >= 0),
  last_attempted_at   timestamptz,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (season, week, recipient_email),
  foreign key (season, week) references public.weeks(season, week) on delete cascade
);

alter table public.recap_deliveries enable row level security;
alter table public.recap_deliveries force row level security;
drop policy if exists recap_deliveries_admin_read on public.recap_deliveries;
create policy recap_deliveries_admin_read on public.recap_deliveries
  for select to authenticated, app_user using (public.is_admin());

revoke all on public.recap_deliveries from public, authenticated, app_user;
grant select on public.recap_deliveries to authenticated, app_user;
grant select, insert, update, delete on public.recap_deliveries to app_pipeline;
grant usage, select on sequence public.recap_deliveries_id_seq to app_pipeline;

-- ----------------------------------------------------- historical identity

-- A franchise is the durable competitive entity. It is intentionally neither
-- an ESPN team id (which can be reused) nor a manager (which can join, leave,
-- or co-own). Human-supplied keys make every ambiguous mapping explicit.
create table if not exists public.franchises (
  franchise_key text primary key check (franchise_key ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  current_name  text not null,
  founded_season int check (founded_season between 1900 and 2100),
  folded_season  int check (folded_season between 1900 and 2100),
  notes          text,
  check (folded_season is null or founded_season is null or folded_season >= founded_season)
);

create table if not exists public.managers (
  manager_key  text primary key check (manager_key ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  display_name text not null,
  notes        text
);

create table if not exists public.franchise_seasons (
  season                 int not null check (season between 1900 and 2100),
  franchise_key          text not null references public.franchises(franchise_key),
  team_name              text not null,
  espn_team_id           int,
  regular_wins           int not null check (regular_wins >= 0),
  regular_losses         int not null check (regular_losses >= 0),
  regular_ties           int not null default 0 check (regular_ties >= 0),
  regular_points_for     numeric(10,2),
  regular_points_against numeric(10,2),
  playoff_wins           int not null default 0 check (playoff_wins >= 0),
  playoff_losses         int not null default 0 check (playoff_losses >= 0),
  final_place            int check (final_place > 0),
  is_champion            boolean not null default false,
  is_runner_up           boolean not null default false,
  source                 text not null default 'manual'
                           check (source in ('manual', 'espn')),
  source_note            text,
  primary key (season, franchise_key),
  check (not is_champion or final_place = 1),
  check (not is_runner_up or final_place = 2)
);

-- One row per manager/franchise/season preserves co-ownership and manager
-- movement without splitting or duplicating the franchise itself.
create table if not exists public.manager_franchise_seasons (
  season        int not null check (season between 1900 and 2100),
  manager_key   text not null references public.managers(manager_key),
  franchise_key text not null references public.franchises(franchise_key),
  is_primary    boolean not null default true,
  primary key (season, manager_key, franchise_key),
  foreign key (season, franchise_key)
    references public.franchise_seasons(season, franchise_key) on delete cascade
);

do $$ declare t text; begin
  foreach t in array array['franchises','managers','franchise_seasons','manager_franchise_seasons'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated, app_user using (true)',
      t || '_public_read', t
    );
    execute format('revoke all on public.%I from public, authenticated, app_user', t);
    execute format('grant select on public.%I to authenticated, app_user', t);
    execute format('grant select, insert, update, delete on public.%I to app_pipeline', t);
  end loop;
end $$;

create or replace view public.franchise_history_totals
with (security_invoker = true) as
select f.franchise_key, f.current_name,
       count(fs.season)::int as seasons,
       sum(fs.regular_wins)::int as regular_wins,
       sum(fs.regular_losses)::int as regular_losses,
       sum(fs.regular_ties)::int as regular_ties,
       sum(fs.playoff_wins)::int as playoff_wins,
       sum(fs.playoff_losses)::int as playoff_losses,
       count(*) filter (where fs.is_champion)::int as championships,
       sum(fs.regular_points_for) as regular_points_for,
       min(fs.season)::int as first_season,
       max(fs.season)::int as last_season
  from public.franchises f
  join public.franchise_seasons fs using (franchise_key)
 group by f.franchise_key, f.current_name;

create or replace view public.manager_history_totals
with (security_invoker = true) as
select m.manager_key, m.display_name,
       count(distinct ms.season)::int as seasons,
       sum(fs.regular_wins)::int as regular_wins,
       sum(fs.regular_losses)::int as regular_losses,
       sum(fs.regular_ties)::int as regular_ties,
       sum(fs.playoff_wins)::int as playoff_wins,
       sum(fs.playoff_losses)::int as playoff_losses,
       count(*) filter (where fs.is_champion)::int as championships,
       min(ms.season)::int as first_season,
       max(ms.season)::int as last_season
  from public.managers m
  join public.manager_franchise_seasons ms using (manager_key)
  join public.franchise_seasons fs
    on fs.season = ms.season and fs.franchise_key = ms.franchise_key
 group by m.manager_key, m.display_name;

grant select on public.franchise_history_totals, public.manager_history_totals
  to authenticated, app_user;

commit;
