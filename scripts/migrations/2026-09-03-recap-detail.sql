-- Per-team worst start/sit decision, so the weekly recap can name it for every
-- matchup rather than only for the league's single worst team-week.
--
-- The pipeline already solves the optimal lineup for every team-week (see
-- pipeline/features.ts optimalLineup) and already knows which benched player
-- should have started. Until now only the aggregate survived into
-- team_week_results -- optimal_points and points_left_on_bench -- while the
-- name was thrown away and re-derived for a single weekly_awards row. The
-- recap needs it ten times a week, once per team.
--
-- Run once as the Neon database owner. Idempotent: a retry is safe.

begin;

alter table public.team_week_results
  add column if not exists worst_bench_player_id bigint
    references public.players (espn_player_id),
  -- What the benched player scored, and what the starter they were passed over
  -- for scored. The second is regularly negative: a D/ST can finish below zero,
  -- which is exactly the decision worth printing.
  add column if not exists worst_bench_points numeric(7, 2),
  add column if not exists worst_bench_started_points numeric(7, 2);

comment on column public.team_week_results.worst_bench_player_id is
  'Highest-scoring benched player the optimal lineup would have started.';

-- The recap looks up the week just played, one season at a time.
create index if not exists team_week_results_worst_bench_idx
  on public.team_week_results (season, week)
  where worst_bench_player_id is not null;

-- The recap runs as app_pipeline and now reads the rivalry view for THE GRUDGE
-- section. This grants no new information: head_to_head is derived entirely
-- from matchups and teams, both of which app_pipeline already reads.
grant select on public.head_to_head to app_pipeline;

commit;
