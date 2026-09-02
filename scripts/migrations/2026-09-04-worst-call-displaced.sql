-- Record WHO the worst start/sit call displaced, not just what it cost.
--
-- The first cut of this paired the best benched player with the
-- lowest-scoring starter on the roster, whoever that happened to be. That
-- produced claims nobody could act on: a benched RB who scored 16 looked
-- like a blunder because the kicker scored 1, when every RB and FLEX slot
-- was already filled by someone who outscored him. A running back cannot be
-- started at kicker.
--
-- worst_bench_started_points now means the points of the starter the benched
-- player could LEGALLY have replaced -- same slot, per ESPN's eligibleSlots --
-- and worst_bench_displaced_player_id names them. Teams that set their lineup
-- correctly now store null here rather than a manufactured mistake.
--
-- Run once as the Neon database owner, after 2026-09-03-recap-detail.sql.
-- Idempotent: a retry is safe. Values are rewritten by `npm run features`.

begin;

alter table public.team_week_results
  add column if not exists worst_bench_displaced_player_id bigint
    references public.players (espn_player_id);

comment on column public.team_week_results.worst_bench_displaced_player_id is
  'Starter the benched player was eligible to replace, at the slot they held.';

comment on column public.team_week_results.worst_bench_started_points is
  'Points scored by that displaced starter. Null when no legal swap gained anything.';

commit;
