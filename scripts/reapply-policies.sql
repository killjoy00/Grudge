create schema if not exists app;

create or replace function app.current_user_id()
returns text language plpgsql stable as $$
declare v text;
begin
  -- Path 1: set per-request by the server after verifying the Clerk session.
  v := nullif(current_setting('app.user_id', true), '');
  if v is not null then return v; end if;

  -- Path 2: a Clerk JWT that Neon itself validated. Wrapped because a role
  -- without USAGE on schema auth raises rather than returning null, and an
  -- identity lookup must fail closed (null), never abort the whole query.
  begin
    v := nullif(auth.user_id(), '');
  exception when others then
    v := null;
  end;
  return v;
end $$;

grant usage   on schema app                  to authenticated, app_user;

grant execute on function app.current_user_id() to authenticated, app_user;

-- Only the webhook handler's server-side credential may call this -- it must
-- never be reachable from a browser session, since it writes is_admin.
-- Reuses app_pipeline: both it and the webhook handler are trusted backend
-- code, never a specific end user, so one "trusted backend" role covers both
-- rather than adding a second role for a single function grant.
revoke all on function public.provision_profile from public, authenticated;

grant execute on function public.provision_profile to app_pipeline;

-- Correct for ROW ownership -- but see below: by itself it is a security hole.
alter table public.profiles enable row level security;

alter table public.profiles force  row level security;

create policy profiles_select on public.profiles
  for select to authenticated, app_user using (true);

create policy profiles_update on public.profiles for update to authenticated, app_user
  using (app.current_user_id() = id) with check (app.current_user_id() = id);

-- 1. column-level grant: authenticated simply cannot write these columns
revoke update on public.profiles from authenticated, app_user;

grant update (display_name) on public.profiles to authenticated, app_user;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, app as $$
  select coalesce((select is_admin from public.profiles where id = app.current_user_id()), false);
$$;

alter table public.predictions enable row level security;

-- Own picks always visible; everyone else's only once the week locks, so nobody
-- can copy picks before kickoff.
create policy predictions_select on public.predictions for select to authenticated, app_user
  using (app.current_user_id() = user_id or public.week_is_locked(season, week));

create policy predictions_insert on public.predictions for insert to authenticated, app_user
  with check (app.current_user_id() = user_id and not public.week_is_locked(season, week));

create policy predictions_update on public.predictions for update to authenticated, app_user
  using      (app.current_user_id() = user_id and not public.week_is_locked(season, week))
  with check (app.current_user_id() = user_id and not public.week_is_locked(season, week));

create policy predictions_delete on public.predictions for delete to authenticated, app_user
  using (app.current_user_id() = user_id and not public.week_is_locked(season, week));

-- Read-only for app_pipeline: it needs to see who picked what in order to
-- score the week on Tuesday, but (as noted at prediction_scores below) never
-- writes this table directly.
grant select on public.predictions to app_pipeline;

alter table public.prediction_scores enable row level security;

create policy prediction_scores_select on public.prediction_scores
  for select to authenticated, app_user using (true);

alter table public.comments enable row level security;

create policy comments_select on public.comments for select to authenticated, app_user using (true);

create policy comments_insert on public.comments for insert to authenticated, app_user
  with check (app.current_user_id() = user_id);

create policy comments_update on public.comments for update to authenticated, app_user
  using (app.current_user_id() = user_id) with check (app.current_user_id() = user_id);

create policy comments_delete on public.comments for delete to authenticated, app_user
  using (app.current_user_id() = user_id or public.is_admin());

-- Publicly readable mirror + computed tables: read for any signed-in member,
-- written only by app_pipeline (BYPASSRLS). This loop is also where
-- app_pipeline's table grant actually needs to run -- see the note in
-- "Shape of the design": a blanket grant issued before these tables existed
-- would reach nothing, so it's issued here, per table, right after each one
-- is confirmed to exist.
do $$
declare t text;
begin
  foreach t in array array[
    'seasons','members','teams','team_owners','weeks','players','lineup_slots',
    'matchups','team_week_results','roster_entries','transactions',
    'transaction_items','faab_ledger','power_rankings','luck_index',
    'playoff_odds','weekly_awards'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated, app_user using (true)',
      t || '_read', t);
    execute format(
      'revoke insert, update, delete on public.%I from authenticated, app_user', t);
    -- The grant that makes the SELECT policy above actually usable.
    execute format('grant select on public.%I to authenticated, app_user', t);
    execute format(
      'grant select, insert, update, delete on public.%I to app_pipeline', t);
  end loop;
end $$;

-- Every policy below references app.current_user_id() or is_admin() (which calls it),
-- and an RLS policy expression is evaluated as the *querying* role -- so
-- `authenticated` needs to be able to call it, or every policy errors instead
-- of filtering. Neon's console grants this when RLS is enabled there; issued
-- explicitly so applying this schema by hand is sufficient on its own.
grant usage   on schema auth             to authenticated, app_user;

grant execute on function app.current_user_id() to authenticated, app_user;

-- Admin-only. Not readable by regular members: it contains everyone's email.
-- app_pipeline needs no grant here: only provision_profile() (SECURITY
-- DEFINER, runs as the function owner) reads this table, never a direct query.
alter table public.league_allowlist enable row level security;

alter table public.league_allowlist force row level security;

create policy allowlist_admin_read on public.league_allowlist
  for select to authenticated, app_user using (public.is_admin());

revoke insert, update, delete on public.league_allowlist from authenticated, app_user;

-- SELECT granted, but the policy restricts it to admins -- grant opens the
-- door, policy decides who walks through.
grant select on public.league_allowlist to authenticated, app_user;

-- Ownership snapshots are an admin feature (Step 8), gated in the DB as well as
-- the route, so a non-admin querying it directly gets nothing.
-- app_pipeline writes these weekly (Step 8's ownership-trend capture).
alter table public.player_ownership_snapshots enable row level security;

alter table public.player_ownership_snapshots force row level security;

create policy ownership_admin_read on public.player_ownership_snapshots
  for select to authenticated, app_user using (public.is_admin());

revoke insert, update, delete on public.player_ownership_snapshots from authenticated, app_user;

grant select on public.player_ownership_snapshots to authenticated, app_user;

grant select, insert, update, delete on public.player_ownership_snapshots to app_pipeline;

-- profiles / predictions / comments keep their own policies from above.
-- ENABLE and FORCE are different things and both are needed -- see the warning.
alter table public.predictions       force row level security;

alter table public.prediction_scores force row level security;

alter table public.comments          force row level security;

-- User-data grants. Each is deliberately WIDER than what a user can actually
-- do, because the policies above are what narrow it: e.g. DELETE is granted on
-- predictions, but predictions_delete restricts it to your own rows in an
-- unlocked week. Grant opens the door; policy decides who walks through.
grant select                         on public.profiles          to authenticated, app_user;

grant update (display_name)          on public.profiles          to authenticated, app_user;

grant select, insert, update, delete on public.predictions       to authenticated, app_user;

grant select                         on public.prediction_scores to authenticated, app_user;

grant select, insert, update, delete on public.comments          to authenticated, app_user;

-- The view has no RLS of its own -- it reads through to predictions and
-- profiles, whose policies apply to the querying role.
grant select on public.prediction_leaderboard to authenticated, app_user;

grant select on public.head_to_head           to authenticated, app_user;

-- prediction_scores: app_pipeline writes these every Tuesday when the pipeline
-- scores the week's picks. authenticated gets SELECT only (above) -- users have
-- no write path to their own score under any circumstance, by design.
grant select, insert, update on public.prediction_scores to app_pipeline;

grant select                 on public.profiles          to app_pipeline;
