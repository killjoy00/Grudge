import 'server-only';

import { asPublic } from './db.ts';

export interface DraftSlotPerformanceRow {
  draft_slot: number;
  graded_drafts: number;
  avg_class_value: string;
  avg_class_rank: string;
  best_drafts: number;
  best_draft_pct: string;
  top3_drafts: number;
  top3_pct: string;
  worst_drafts: number;
  worst_pct: string;
}

export interface DraftSlotOutcomeRow {
  draft_slot: number;
  seasons_on_file: number;
  regular_season_firsts: number;
  regular_season_first_pct: string;
  championships: number;
  championship_pct: string;
}

export interface FranchiseDraftSlotRow {
  franchise_key: string;
  team_name: string;
  drafts_on_file: number;
  most_common_slot: number;
  most_common_slot_times: number;
  first_overall_times: number;
}

export interface DraftSlotRecords {
  performance: DraftSlotPerformanceRow[];
  outcomes: DraftSlotOutcomeRow[];
  franchises: FranchiseDraftSlotRow[];
}

const GRADED_CTE = `
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
), ranked as (
  select base.*,
         row_number() over (
           partition by season, default_position_id
           order by overall_pick
         )::int as draft_pos_rank,
         rank() over (
           partition by season, default_position_id
           order by fantasy_points desc
         )::int as production_pos_rank
    from base
), scored as (
  select ranked.*,
         (draft_pos_rank - production_pos_rank)::int as value_delta
    from ranked
)
`;

export async function getDraftSlotRecords(): Promise<DraftSlotRecords> {
  const [performance, outcomes, franchises] = await Promise.all([
    asPublic<DraftSlotPerformanceRow>(`${GRADED_CTE},
      class_scores as (
        select season, espn_team_id,
               count(*)::int as graded_picks,
               avg(value_delta)::numeric as avg_value_delta,
               sum(value_delta)::int as total_value_delta
          from scored
         group by season, espn_team_id
        having count(*) >= 8
      ), class_ranked as (
        select class_scores.*,
               rank() over (
                 partition by season
                 order by avg_value_delta desc, total_value_delta desc
               )::int as class_rank,
               rank() over (
                 partition by season
                 order by avg_value_delta asc, total_value_delta asc
               )::int as worst_rank
          from class_scores
      ), slots as (
        select d.season, d.espn_team_id, d.overall_pick::int as draft_slot
          from public.draft_picks d
         where d.round = 1
           and d.season between 2008 and 2025
           and d.season <> 2020
      ), slot_classes as (
        select slots.draft_slot, class_ranked.*
          from slots
          join class_ranked
            on class_ranked.season = slots.season
           and class_ranked.espn_team_id = slots.espn_team_id
      )
      select draft_slot,
             count(*)::int as graded_drafts,
             round(avg(avg_value_delta)::numeric, 2)::text as avg_class_value,
             round(avg(class_rank)::numeric, 2)::text as avg_class_rank,
             count(*) filter (where class_rank = 1)::int as best_drafts,
             round(100.0 * count(*) filter (where class_rank = 1) / nullif(count(*), 0), 1)::text as best_draft_pct,
             count(*) filter (where class_rank <= 3)::int as top3_drafts,
             round(100.0 * count(*) filter (where class_rank <= 3) / nullif(count(*), 0), 1)::text as top3_pct,
             count(*) filter (where worst_rank = 1)::int as worst_drafts,
             round(100.0 * count(*) filter (where worst_rank = 1) / nullif(count(*), 0), 1)::text as worst_pct
        from slot_classes
       group by draft_slot
       order by draft_slot`),
    asPublic<DraftSlotOutcomeRow>(`
      with slot_rows as (
        select d.season,
               d.overall_pick::int as draft_slot,
               tf.franchise_key
          from public.draft_picks d
          join public.team_franchise tf
            on tf.season = d.season and tf.espn_team_id = d.espn_team_id
         where d.round = 1
           and d.season between 2005 and 2025
           and d.season <> 2020
      ), regular_ranked as (
        select fs.season,
               fs.franchise_key,
               row_number() over (
                 partition by fs.season
                 order by (fs.regular_wins + fs.regular_ties / 2.0)
                          / nullif(fs.regular_wins + fs.regular_losses + fs.regular_ties, 0) desc,
                          fs.regular_points_for desc,
                          fs.franchise_key
               ) as regular_rank,
               fs.is_champion
          from public.franchise_seasons fs
         where fs.season between 2005 and 2025
           and fs.season <> 2020
      )
      select sr.draft_slot,
             count(*)::int as seasons_on_file,
             count(*) filter (where rr.regular_rank = 1)::int as regular_season_firsts,
             round(100.0 * count(*) filter (where rr.regular_rank = 1) / nullif(count(*), 0), 1)::text as regular_season_first_pct,
             count(*) filter (where rr.is_champion)::int as championships,
             round(100.0 * count(*) filter (where rr.is_champion) / nullif(count(*), 0), 1)::text as championship_pct
        from slot_rows sr
        left join regular_ranked rr
          on rr.season = sr.season
         and rr.franchise_key = sr.franchise_key
       group by sr.draft_slot
       order by sr.draft_slot`),
    asPublic<FranchiseDraftSlotRow>(`
      with slot_rows as (
        select d.season,
               d.overall_pick::int as draft_slot,
               tf.franchise_key,
               coalesce(f.current_name, tf.team_name) as team_name
          from public.draft_picks d
          join public.team_franchise tf
            on tf.season = d.season and tf.espn_team_id = d.espn_team_id
          left join public.franchises f using (franchise_key)
         where d.round = 1
           and d.season between 2005 and 2025
           and d.season <> 2020
      ), slot_counts as (
        select franchise_key,
               max(team_name) as team_name,
               draft_slot,
               count(*)::int as times,
               row_number() over (
                 partition by franchise_key
                 order by count(*) desc, draft_slot asc
               ) as slot_rank
          from slot_rows
         group by franchise_key, draft_slot
      ), totals as (
        select franchise_key,
               max(team_name) as team_name,
               count(*)::int as drafts_on_file,
               count(*) filter (where draft_slot = 1)::int as first_overall_times
          from slot_rows
         group by franchise_key
      )
      select totals.franchise_key,
             totals.team_name,
             totals.drafts_on_file,
             slot_counts.draft_slot::int as most_common_slot,
             slot_counts.times::int as most_common_slot_times,
             totals.first_overall_times
        from totals
        join slot_counts
          on slot_counts.franchise_key = totals.franchise_key
         and slot_counts.slot_rank = 1
       order by totals.first_overall_times desc, totals.team_name`),
  ]);

  return { performance, outcomes, franchises };
}
