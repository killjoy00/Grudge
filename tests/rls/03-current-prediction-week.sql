-- Regression for the Saturday-lock / next-week hole.
--
-- Week 1 in the base fixture is the current incomplete week. Add a later week
-- whose own deadline is safely in the future. Before the current-week trigger,
-- that future week was writable simply because it was not locked yet.

reset role; reset app.user_id;

insert into public.weeks
  (season, week, first_kickoff_at, locks_at, status, results_complete)
values
  (2026, 3, now() + interval '20 days', now() + interval '19 days', 'upcoming', false)
on conflict (season, week) do update set
  first_kickoff_at = excluded.first_kickoff_at,
  locks_at = excluded.locks_at,
  status = excluded.status,
  results_complete = false;

insert into public.matchups
  (season, espn_matchup_id, week, home_team_id, away_team_id)
values (2026, 301, 3, 6, 11)
on conflict (season, espn_matchup_id) do nothing;

set role app_user;
set app.user_id = 'user_test_owner_0001';

select test.expect_error(
  $$insert into public.predictions
      (user_id, season, week, espn_matchup_id, predicted_winner_team_id)
    values (app.current_user_id(), 2026, 3, 301, 6)$$,
  'T58 ATTACK pick a FUTURE unlocked week before the current week settles');

reset role; reset app.user_id;

do $$
begin
  if exists (
    select 1 from test.results
     where label = 'T58 ATTACK pick a FUTURE unlocked week before the current week settles'
       and not ok
  ) then
    raise exception 'future prediction week regression FAILED';
  end if;
end $$;
