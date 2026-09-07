/**
 * Shared draft-grade query.
 *
 * A pick has two 0-100 scores:
 *   - production: its finish within that season and position (best = 100);
 *   - capital: its place on the overall draft board (first pick = 100).
 *
 * `value_delta` is production minus capital.  Unlike the retired difference
 * between two raw positional ranks, this has the same bounds for QB, RB, WR
 * and TE and charges the actual overall pick spent.  A position with 50
 * drafted players therefore cannot manufacture five times the value range of
 * a position with 10.
 */
export const DRAFT_VALUE_METHOD = 'production percentile minus overall-pick capital percentile';

export function draftValueDelta(productionScore: number, capitalScore: number): number {
  return Math.round((productionScore - capitalScore) * 100) / 100;
}

export const GRADED_DRAFT_CTE = `
with modern_weekly as (
  select r.season, r.week, r.espn_player_id,
         max(r.applied_points)::numeric as points
    from public.roster_entries r
    join public.weeks w
      on w.season = r.season and w.week = r.week and w.results_complete
   where r.season between 2018 and 2025
   group by r.season, r.week, r.espn_player_id
), modern_production as (
  select season, espn_player_id, sum(points)::numeric as fantasy_points,
         'espn_weekly'::text as performance_source
    from modern_weekly
   group by season, espn_player_id
), production as (
  select season, espn_player_id, fantasy_points::numeric, source::text as performance_source
    from public.legacy_draft_performance
  union all
  select season, espn_player_id, fantasy_points, performance_source
    from modern_production
), base as (
  select d.season, d.overall_pick, d.round, d.round_pick,
         d.espn_team_id, d.espn_player_id,
         p.full_name, p.default_position_id,
         coalesce(pr.fantasy_points, 0)::numeric as fantasy_points,
         coalesce(pr.performance_source, 'missing')::text as performance_source,
         tf.franchise_key, tf.team_name,
         m.manager_key, m.display_name as manager
    from public.draft_picks d
    join public.players p using (espn_player_id)
    join public.team_franchise tf
      on tf.season = d.season and tf.espn_team_id = d.espn_team_id
    left join production pr
      on pr.season = d.season and pr.espn_player_id = d.espn_player_id
    left join public.manager_franchise_seasons ms
      on ms.season = tf.season and ms.franchise_key = tf.franchise_key and ms.is_primary
    left join public.managers m using (manager_key)
   where d.season between 2008 and 2025
     and d.season <> 2020
     and p.default_position_id in (1, 2, 3, 4)
), scored as (
  select base.*,
         round((100 * percent_rank() over (
           partition by season, default_position_id
           order by fantasy_points
         ))::numeric, 2) as production_score,
         round((100 * (1 - percent_rank() over (
           partition by season
           order by overall_pick
         )))::numeric, 2) as draft_capital_score
    from base
), graded as (
  select scored.*,
         round((production_score - draft_capital_score)::numeric, 2) as value_delta
    from scored
)
`;
