import 'server-only';
import { unstable_cache } from 'next/cache';

import { asPublic } from './db.ts';
import { GRADED_DRAFT_CTE } from './draft-ranking.ts';

export interface DraftSlotPerformanceRow {
  draft_slot: number;
  graded_drafts: number;
  first_season: number;
  last_season: number;
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
  first_season: number;
  last_season: number;
  regular_season_firsts: number;
  regular_season_first_pct: string;
  championships: number;
  championship_pct: string;
}

export interface FranchiseDraftSlotRow {
  franchise_key: string;
  team_name: string;
  drafts_on_file: number;
  first_season: number;
  last_season: number;
  most_common_slot: number;
  most_common_slot_times: number;
  first_overall_times: number;
}

export interface DraftSlotRecords {
  performance: DraftSlotPerformanceRow[];
  outcomes: DraftSlotOutcomeRow[];
  franchises: FranchiseDraftSlotRow[];
}

async function draftSlotRecordsRaw(): Promise<DraftSlotRecords> {
  const [performance, outcomes, franchises] = await Promise.all([
    asPublic<DraftSlotPerformanceRow>(`${GRADED_DRAFT_CTE},
      class_scores as (
        select season, espn_team_id,
               count(*)::int as graded_picks,
               avg(value_delta)::numeric as avg_value_delta,
               sum(value_delta)::numeric as total_value_delta
          from graded
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
           and d.season >= 2008
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
             min(season)::int as first_season,
             max(season)::int as last_season,
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
               fst.franchise_key
          from public.draft_picks d
          join public.franchise_season_teams fst
            on fst.season = d.season and fst.espn_team_id = d.espn_team_id
          join public.franchise_season_results fsr
            on fsr.season = fst.season and fsr.franchise_key = fst.franchise_key
         where d.round = 1
           and d.season >= 2005
           and d.season <> 2020
      ), regular_ranked as (
        select fsr.season,
               fsr.franchise_key,
               row_number() over (
                 partition by fsr.season
                 order by (fsr.regular_wins + fsr.regular_ties / 2.0)
                          / nullif(fsr.regular_wins + fsr.regular_losses + fsr.regular_ties, 0) desc,
                          fsr.regular_points_for desc,
                          fsr.franchise_key
               ) as regular_rank,
               fsr.is_champion
          from public.franchise_season_results fsr
         where fsr.season >= 2005
           and fsr.season <> 2020
      )
      select sr.draft_slot,
             count(*)::int as seasons_on_file,
             min(sr.season)::int as first_season,
             max(sr.season)::int as last_season,
             count(*) filter (where rr.regular_rank = 1)::int as regular_season_firsts,
             round(100.0 * count(*) filter (where rr.regular_rank = 1) / nullif(count(*), 0), 1)::text as regular_season_first_pct,
             count(*) filter (where rr.is_champion)::int as championships,
             round(100.0 * count(*) filter (where rr.is_champion) / nullif(count(*), 0), 1)::text as championship_pct
        from slot_rows sr
        join regular_ranked rr
          on rr.season = sr.season
         and rr.franchise_key = sr.franchise_key
       group by sr.draft_slot
       order by sr.draft_slot`),
    asPublic<FranchiseDraftSlotRow>(`
      with slot_rows as (
        select d.season,
               d.overall_pick::int as draft_slot,
               fst.franchise_key,
               coalesce(f.current_name, fst.team_name) as team_name
          from public.draft_picks d
          join public.franchise_season_teams fst
            on fst.season = d.season and fst.espn_team_id = d.espn_team_id
          left join public.franchises f using (franchise_key)
         where d.round = 1
           and d.season >= 2005
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
               min(season)::int as first_season,
               max(season)::int as last_season,
               count(*) filter (where draft_slot = 1)::int as first_overall_times
          from slot_rows
         group by franchise_key
      )
      select totals.franchise_key,
             totals.team_name,
             totals.drafts_on_file,
             totals.first_season,
             totals.last_season,
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

export const getDraftSlotRecords = unstable_cache(draftSlotRecordsRaw, ['draft-slot-records-2026.5'], { revalidate: 3600 });
