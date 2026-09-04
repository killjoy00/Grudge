-- A pick that has not been played is not a loss.
--
-- Both leaderboard views reported `picks_made` as count(*) over every
-- prediction, scored or not, and every consumer rendered a record as
-- "correct - (picks_made - correct)". So the moment you made a pick, before a
-- single game kicked off, it counted as a loss: pick all five games in week
-- one and your record read 0-5.
--
-- The scorer itself was never wrong. pipeline/score-predictions.ts joins on
-- `m.is_final and m.winner <> 'UNDECIDED'`, so a prediction_scores row exists
-- ONLY for a decided game. The views simply counted the wrong thing.
--
-- SECOND, SUBTLER CASE, fixed at the same time: a TIE.
-- score-predictions resolves the winning team id to NULL for a tie, so
-- `is_correct` is NULL rather than false -- deliberately, because picking
-- either side of a tie was neither right nor wrong and it scores 0 points.
-- But `count(*) filter (where is_correct)` counts only TRUE, so a tie landed
-- in "not correct" and showed as a loss as well.
--
-- The counts are now stated explicitly rather than inferred by subtraction:
--
--   picks_made  every pick made, decided or not
--   decided     picks with a result (correct + incorrect + pushed)
--   correct     is_correct true
--   incorrect   is_correct false        <- THE loss count
--   pushed      is_correct null: a tie
--   pending     made but not yet played
--
-- accuracy now divides by correct + incorrect instead of by every scored
-- pick, so a tie no longer quietly drags a percentage down.
--
-- DROP AND RECREATE, not CREATE OR REPLACE: replace can only append columns,
-- and `decided` belongs next to the other counts rather than bolted on the
-- end. That means the grants and the security_invoker setting have to be put
-- back by hand, which is what the tail of this file does.
--
-- The two views DIFFER on security_invoker today -- the per-season one
-- bypasses RLS on `predictions`, the all-time one does not. That is
-- pre-existing and is preserved exactly here rather than quietly harmonised:
-- changing it would either hide rows or widen what is visible, and neither
-- belongs in a migration about counting. Nothing is leaked either way, since
-- both views expose per-user aggregates and never an individual pick.
--
-- Run once as the Neon database owner. Idempotent: a retry is safe.

begin;

drop view if exists public.prediction_leaderboard;
drop view if exists public.prediction_leaderboard_alltime;

create view public.prediction_leaderboard as
select p.user_id,
       pr.display_name,
       p.season,
       count(*)                                               as picks_made,
       count(s.prediction_id)                                 as decided,
       count(*) filter (where s.is_correct)                    as correct,
       count(*) filter (where s.is_correct = false)            as incorrect,
       count(*) filter (where s.prediction_id is not null
                          and s.is_correct is null)            as pushed,
       count(*) - count(s.prediction_id)                       as pending,
       coalesce(sum(s.points), 0::numeric)                     as points,
       round(
         (count(*) filter (where s.is_correct))::numeric
         / nullif(count(*) filter (where s.is_correct is not null), 0)::numeric,
         4
       )                                                       as accuracy
  from public.predictions p
  join public.profiles pr on pr.id = p.user_id
  left join public.prediction_scores s on s.prediction_id = p.id
 group by p.user_id, pr.display_name, p.season;

-- security_invoker=true, matching what this view carried before.
create view public.prediction_leaderboard_alltime
with (security_invoker = true) as
select p.user_id,
       pr.display_name,
       count(*)                                               as picks_made,
       count(s.prediction_id)                                 as decided,
       count(*) filter (where s.is_correct)                    as correct,
       count(*) filter (where s.is_correct = false)            as incorrect,
       count(*) filter (where s.prediction_id is not null
                          and s.is_correct is null)            as pushed,
       count(*) - count(s.prediction_id)                       as pending,
       coalesce(sum(s.points), 0::numeric)                     as points,
       round(
         (count(*) filter (where s.is_correct))::numeric
         / nullif(count(*) filter (where s.is_correct is not null), 0)::numeric,
         4
       )                                                       as accuracy,
       min(p.season)                                           as first_season,
       max(p.season)                                           as last_season
  from public.predictions p
  join public.profiles pr on pr.id = p.user_id
  left join public.prediction_scores s on s.prediction_id = p.id
 group by p.user_id, pr.display_name;

-- GRANTS RESTORED -- and app_user is the one that matters.
--
-- There is an ALTER DEFAULT PRIVILEGES rule in this database granting
-- `authenticated` arwd on every new relation in public, so that role gets its
-- privileges back the instant the view is created, without anything here.
-- app_user is NOT covered by it and gets nothing by default.
--
-- app_user is the role the web app connects as. So dropping a view and
-- forgetting this line would not fail the migration or trip a test -- it
-- would take the predictions page down with a permission error the next time
-- somebody loaded it. Any future drop-and-recreate in this schema needs the
-- same line.
grant select on public.prediction_leaderboard to authenticated, app_user;
grant select on public.prediction_leaderboard_alltime to authenticated, app_user;

comment on view public.prediction_leaderboard is
  'Per-season pick record. `incorrect` is the loss count; an unplayed pick is `pending`, not a loss.';
comment on view public.prediction_leaderboard_alltime is
  'All-time pick record. `incorrect` is the loss count; an unplayed pick is `pending`, not a loss.';

commit;
