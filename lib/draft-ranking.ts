import { DRAFT_MODEL_VERSION } from '../pipeline/draft-model.ts';
export { DRAFT_VALUE_METHOD } from '../pipeline/draft-model.ts';

/** Read one published model generation; never derive production from ownership. */
export const GRADED_DRAFT_CTE = `
with published as (
  select r.*
    from public.model_publications p
    join public.model_runs m on m.run_id = p.run_id
    join public.draft_grade_results r on r.run_id = m.run_id and r.season = p.season
   where p.model_kind = 'draft' and p.coverage_status = 'ready'
     and m.model_version = '${DRAFT_MODEL_VERSION}'
), eligible_seasons as (
  select s.season from published s group by s.season
  having (select count(*) from public.draft_picks d where d.season = s.season)
           = max((s.result->>'total_picks')::int)
     and not exists (
       select 1 from published x where x.season = s.season and not exists (
         select 1 from public.draft_picks d
         join public.team_franchise tf on tf.season = d.season and tf.espn_team_id = d.espn_team_id
         where d.season = x.season and d.overall_pick = x.overall_pick
           and d.espn_player_id = x.espn_player_id and d.espn_team_id = x.espn_team_id
       )
     )
), graded as (
  select d.season, d.overall_pick, d.round, d.round_pick, d.espn_team_id, d.espn_player_id,
         r.player_key,
         r.result->>'full_name' as full_name,
         (r.result->>'position')::int as default_position_id,
         (r.result->>'fantasy_points')::numeric as fantasy_points,
         (r.result->>'active_weeks')::int as active_weeks,
         r.result->>'performance_source' as performance_source,
         (r.result->>'production_score')::numeric as production_score,
         (r.result->>'draft_capital_score')::numeric as draft_capital_score,
         (r.result->>'value_delta')::numeric as value_delta,
         tf.franchise_key, tf.team_name, m.manager_key, m.display_name as manager
    from published r join eligible_seasons e on e.season = r.season
    join public.draft_picks d on d.season = r.season and d.overall_pick = r.overall_pick
      and d.espn_player_id = r.espn_player_id and d.espn_team_id = r.espn_team_id
    join public.team_franchise tf on tf.season = d.season and tf.espn_team_id = d.espn_team_id
    left join public.manager_franchise_seasons ms
      on ms.season = tf.season and ms.franchise_key = tf.franchise_key and ms.is_primary
    left join public.managers m using (manager_key)
)
`;
