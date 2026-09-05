-- A prediction belongs to the week the league is currently in, not merely any
-- week whose deadline happens to be in the future.
--
-- Before this migration the trigger only asked whether the submitted week was
-- locked. Once week 1 locked on Saturday night, week 2 was still unlocked, so
-- a caller who supplied week=2 directly could save a pick before week 1 had
-- even finished. The page also used the future lock time to choose which board
-- to display, which made that same bad state reachable from the UI.
--
-- "Current" is the first week whose results are not complete. That keeps the
-- just-locked board current through the games and through Monday night, then
-- advances naturally when Tuesday's pipeline marks the week complete.

begin;

create or replace function public.prediction_week_is_current(p_season int, p_week int)
returns boolean
language sql stable as $$
  select coalesce(
    p_week = (
      select min(w.week)
        from public.weeks w
       where w.season = p_season
         and not w.results_complete
    ),
    false
  );
$$;

grant execute on function public.prediction_week_is_current(int, int)
  to authenticated, app_user;

create or replace function public.enforce_prediction_lock()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- The one escape hatch exists for owner-run fixtures/backfills. Production
  -- web sessions never set it.
  if current_setting('app.allow_locked_writes', true) is distinct from 'on' then
    if not public.prediction_week_is_current(new.season, new.week) then
      raise exception 'week %/% is not the current prediction week', new.season, new.week
        using errcode = '55000';
    end if;

    if public.week_is_locked(new.season, new.week) then
      raise exception 'week %/% is locked', new.season, new.week
        using errcode = '55000';
    end if;
  end if;

  return new;
end $$;

commit;
