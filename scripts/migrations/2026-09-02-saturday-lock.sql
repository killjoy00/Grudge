-- Predictions lock on Saturday, and an all-time prediction record.
--
-- THE LOCK RULE, in one place: picks for a week close at the end of Saturday
-- night in US Eastern time -- midnight Saturday->Sunday -- so the whole of
-- Saturday is still open and nothing can be changed once Sunday's games begin.
--
-- Before this, weeks.locks_at was null everywhere and week_is_locked() fell
-- back to first_kickoff_at, which is the Thursday game. That gave roughly two
-- days less than the league actually wants.
--
-- The arithmetic is done in Postgres rather than JS on purpose: date_trunc and
-- `at time zone` get daylight saving right across a September-to-January
-- season, and hand-rolled offset math does not.
--
-- Run once as the Neon database owner. Idempotent: a retry is safe.

begin;

-- Saturday-midnight Eastern for the week containing a given kickoff.
-- date_trunc('week') lands on Monday 00:00 local; +6 days is Sunday 00:00
-- local, which is the instant Saturday ends.
create or replace function public.saturday_lock(p_kickoff timestamptz)
returns timestamptz
language sql immutable as $$
  select case when p_kickoff is null then null else
    (date_trunc('week', (p_kickoff at time zone 'America/New_York'))
       + interval '6 days') at time zone 'America/New_York'
  end;
$$;

comment on function public.saturday_lock(timestamptz) is
  'Picks close at the end of Saturday night (US Eastern) for the week containing this kickoff.';

update public.weeks
   set locks_at = public.saturday_lock(first_kickoff_at)
 where first_kickoff_at is not null
   and locks_at is distinct from public.saturday_lock(first_kickoff_at);

-- The season leaderboard already exists. This is the same shape with the
-- season dimension collapsed, for the all-time record on the picks page.
drop view if exists public.prediction_leaderboard_alltime;
create view public.prediction_leaderboard_alltime
with (security_invoker = true) as
select p.user_id,
       pr.display_name,
       count(*) as picks_made,
       count(*) filter (where s.is_correct) as correct,
       coalesce(sum(s.points), 0::numeric) as points,
       round(count(*) filter (where s.is_correct)::numeric
             / nullif(count(s.prediction_id), 0)::numeric, 4) as accuracy,
       min(p.season)::int as first_season,
       max(p.season)::int as last_season
  from public.predictions p
  join public.profiles pr on pr.id = p.user_id
  left join public.prediction_scores s on s.prediction_id = p.id
 group by p.user_id, pr.display_name;

grant select on public.prediction_leaderboard_alltime to authenticated, app_user;
grant execute on function public.saturday_lock(timestamptz) to authenticated, app_user;

commit;
