import 'server-only';
import { unstable_cache } from 'next/cache';

import { asPublic } from './db.ts';
import { DRAFT_PICK_SORT, GRADED_DRAFT_CTE } from './draft-ranking.ts';

export interface DraftClassRow {
  season: number;
  franchise_key: string;
  team_name: string;
  manager_key: string | null;
  manager: string | null;
  graded_picks: number;
  avg_value_delta: string;
  total_value_delta: string;
  fantasy_points: string;
}

export interface DraftPickValueRow {
  season: number;
  overall_pick: number;
  round: number;
  round_pick: number;
  franchise_key: string;
  team_name: string;
  manager_key: string | null;
  manager: string | null;
  player_key: string;
  espn_player_id: number;
  full_name: string | null;
  default_position_id: number | null;
  fantasy_points: string;
  performance_source: string;
  active_weeks: number | null;
  production_score: string;
  draft_capital_score: string;
  value_delta: string;
}

export interface RepeatDraftRow {
  franchise_key: string;
  team_name: string;
  player_key: string;
  full_name: string | null;
  times_drafted: number;
  seasons: string;
}

export interface FirstRoundPositionRow {
  default_position_id: number | null;
  picks: number;
}

export interface DraftPositionSummaryRow {
  default_position_id: number;
  picks: number;
  first_picks: number;
}

export interface FranchiseDraftPositionRow {
  franchise_key: string;
  team_name: string;
  total_picks: number;
  drafts_on_file: number;
  most_drafted_position_id: number | null;
  most_drafted_picks: number | null;
  first_pick_position_id: number | null;
  first_pick_times: number | null;
  best_value_position_id: number | null;
  best_avg_value_delta: string | null;
  best_graded_picks: number | null;
  worst_value_position_id: number | null;
  worst_avg_value_delta: string | null;
  worst_graded_picks: number | null;
}

export interface DraftRecords {
  coverage: { board_seasons: number[]; graded_seasons: number[]; blocked_seasons: number[] };
  bestClasses: DraftClassRow[];
  worstClasses: DraftClassRow[];
  steals: DraftPickValueRow[];
  busts: DraftPickValueRow[];
  productiveMisses: DraftPickValueRow[];
  repeats: RepeatDraftRow[];
  firstRoundPositions: FirstRoundPositionRow[];
  positionSummary: DraftPositionSummaryRow[];
  franchisePositions: FranchiseDraftPositionRow[];
}

/** All grade tables share one versioned, coverage-gated result set. */
async function draftRecordsRaw(): Promise<DraftRecords> {
  const [
    coverageRows,
    bestClasses,
    worstClasses,
    steals,
    busts,
    productiveMisses,
    repeats,
    firstRoundPositions,
    positionSummary,
    franchisePositions,
  ] = await Promise.all([
    asPublic<DraftRecords['coverage']>(`${GRADED_DRAFT_CTE}
      select array(select distinct season from public.draft_picks where season >= 2005 and season <> 2020 order by season) as board_seasons,
        array(select distinct season from graded order by season) as graded_seasons,
        array(select season from public.model_publications where model_kind='draft' and coverage_status='blocked' order by season) as blocked_seasons`),
    asPublic<DraftClassRow>(`${GRADED_DRAFT_CTE}
      select season, franchise_key, team_name, manager_key, manager,
             count(*)::int as graded_picks,
             round(avg(value_delta)::numeric, 2)::text as avg_value_delta,
             round(sum(value_delta)::numeric, 2)::text as total_value_delta,
             round(sum(fantasy_points)::numeric, 1)::text as fantasy_points
        from graded
       group by season, franchise_key, team_name, manager_key, manager
      having count(*) >= 8
       order by avg(value_delta) desc, sum(value_delta) desc, season asc
       limit 10`),
    asPublic<DraftClassRow>(`${GRADED_DRAFT_CTE}
      select season, franchise_key, team_name, manager_key, manager,
             count(*)::int as graded_picks,
             round(avg(value_delta)::numeric, 2)::text as avg_value_delta,
             round(sum(value_delta)::numeric, 2)::text as total_value_delta,
             round(sum(fantasy_points)::numeric, 1)::text as fantasy_points
        from graded
       group by season, franchise_key, team_name, manager_key, manager
      having count(*) >= 8
       order by avg(value_delta) asc, sum(value_delta) asc, season asc
       limit 10`),
    asPublic<DraftPickValueRow>(`${GRADED_DRAFT_CTE}
      select season, overall_pick, round, round_pick, franchise_key, team_name,
             manager_key, manager, player_key, espn_player_id::int, full_name, default_position_id,
             round(fantasy_points, 1)::text as fantasy_points, performance_source,
             active_weeks, production_score::text, draft_capital_score::text, value_delta::text
        from graded
       order by ${DRAFT_PICK_SORT.steals}
       limit 10`),
    asPublic<DraftPickValueRow>(`${GRADED_DRAFT_CTE}
      select season, overall_pick, round, round_pick, franchise_key, team_name,
             manager_key, manager, player_key, espn_player_id::int, full_name, default_position_id,
             round(fantasy_points, 1)::text as fantasy_points, performance_source,
             active_weeks, production_score::text, draft_capital_score::text, value_delta::text
        from graded
       order by ${DRAFT_PICK_SORT.busts}
       limit 10`),
    asPublic<DraftPickValueRow>(`${GRADED_DRAFT_CTE}
      select season, overall_pick, round, round_pick, franchise_key, team_name,
             manager_key, manager, player_key, espn_player_id::int, full_name, default_position_id,
             round(fantasy_points, 1)::text as fantasy_points, performance_source,
             active_weeks, production_score::text, draft_capital_score::text,
             value_delta::text
        from graded
       where active_weeks >= 8
       order by ${DRAFT_PICK_SORT.productiveMisses}
       limit 5`),
    asPublic<RepeatDraftRow>(`
      select tf.franchise_key,
             coalesce(f.current_name, tf.team_name) as team_name,
             a.player_key,
             np.full_name,
             count(*)::int as times_drafted,
             string_agg(d.season::text, ', ' order by d.season) as seasons
        from public.draft_picks d
        join public.team_franchise tf
          on tf.season = d.season and tf.espn_team_id = d.espn_team_id
        join public.nfl_player_aliases a
          on a.season = d.season and a.espn_player_id = d.espn_player_id
        join public.nfl_players np using (player_key)
        left join public.franchises f using (franchise_key)
       where d.season >= 2005
         and d.season <> 2020
       group by tf.franchise_key, coalesce(f.current_name, tf.team_name), a.player_key, np.full_name
      having count(*) >= 3
       order by count(*) desc, np.full_name nulls last
       limit 12`),
    asPublic<FirstRoundPositionRow>(`
      select pi.position_id as default_position_id,
             count(*)::int as picks
        from public.draft_picks d
        left join public.player_identity pi
          on pi.season = d.season and pi.espn_player_id = d.espn_player_id
       where d.round = 1
         and d.season >= 2005
         and d.season <> 2020
       group by pi.position_id
       order by count(*) desc, pi.position_id nulls last`),
    asPublic<DraftPositionSummaryRow>(`
      with draft_base as (
        select d.season, d.overall_pick, tf.franchise_key, pi.position_id as default_position_id
          from public.draft_picks d
          join public.team_franchise tf
            on tf.season = d.season and tf.espn_team_id = d.espn_team_id
          left join public.player_identity pi
            on pi.season = d.season and pi.espn_player_id = d.espn_player_id
         where d.season >= 2005
           and d.season <> 2020
           and pi.position_id is not null
      ), first_pick_rows as (
        select draft_base.*,
               row_number() over (
                 partition by season, franchise_key
                 order by overall_pick
               ) as team_pick_number
          from draft_base
      ), pick_counts as (
        select default_position_id, count(*)::int as picks
          from draft_base
         group by default_position_id
      ), first_counts as (
        select default_position_id, count(*)::int as first_picks
          from first_pick_rows
         where team_pick_number = 1
         group by default_position_id
      )
      select pc.default_position_id::int,
             pc.picks,
             coalesce(fc.first_picks, 0)::int as first_picks
        from pick_counts pc
        left join first_counts fc using (default_position_id)
       order by pc.picks desc, pc.default_position_id`),
    asPublic<FranchiseDraftPositionRow>(`${GRADED_DRAFT_CTE},
      draft_base as (
        select d.season, d.overall_pick, tf.franchise_key,
               coalesce(f.current_name, tf.team_name) as team_name,
               pi.position_id as default_position_id
          from public.draft_picks d
          join public.team_franchise tf
            on tf.season = d.season and tf.espn_team_id = d.espn_team_id
          left join public.franchises f using (franchise_key)
          left join public.player_identity pi
            on pi.season = d.season and pi.espn_player_id = d.espn_player_id
         where d.season >= 2005
           and d.season <> 2020
           and pi.position_id is not null
      ), franchise_totals as (
        select franchise_key,
               max(team_name) as team_name,
               count(*)::int as total_picks,
               count(distinct season)::int as drafts_on_file
          from draft_base
         group by franchise_key
      ), position_counts as (
        select franchise_key, default_position_id,
               count(*)::int as picks,
               row_number() over (
                 partition by franchise_key
                 order by count(*) desc, default_position_id
               ) as position_rank
          from draft_base
         group by franchise_key, default_position_id
      ), first_pick_rows as (
        select draft_base.*,
               row_number() over (
                 partition by season, franchise_key
                 order by overall_pick
               ) as team_pick_number
          from draft_base
      ), first_pick_counts as (
        select franchise_key, default_position_id,
               count(*)::int as times,
               row_number() over (
                 partition by franchise_key
                 order by count(*) desc, default_position_id
               ) as position_rank
          from first_pick_rows
         where team_pick_number = 1
         group by franchise_key, default_position_id
      ), value_by_position as (
        select franchise_key, default_position_id,
               count(*)::int as graded_picks,
               round(avg(value_delta)::numeric, 2)::text as avg_value_delta,
               row_number() over (
                 partition by franchise_key
                 order by avg(value_delta) desc, count(*) desc, default_position_id
               ) as best_rank,
               row_number() over (
                 partition by franchise_key
                 order by avg(value_delta) asc, count(*) desc, default_position_id
               ) as worst_rank
          from graded
         group by franchise_key, default_position_id
        having count(*) >= 8
      )
      select ft.franchise_key, ft.team_name, ft.total_picks, ft.drafts_on_file,
             pc.default_position_id::int as most_drafted_position_id,
             pc.picks::int as most_drafted_picks,
             fp.default_position_id::int as first_pick_position_id,
             fp.times::int as first_pick_times,
             best.default_position_id::int as best_value_position_id,
             best.avg_value_delta as best_avg_value_delta,
             best.graded_picks::int as best_graded_picks,
             worst.default_position_id::int as worst_value_position_id,
             worst.avg_value_delta as worst_avg_value_delta,
             worst.graded_picks::int as worst_graded_picks
        from franchise_totals ft
        left join position_counts pc
          on pc.franchise_key = ft.franchise_key and pc.position_rank = 1
        left join first_pick_counts fp
          on fp.franchise_key = ft.franchise_key and fp.position_rank = 1
        left join value_by_position best
          on best.franchise_key = ft.franchise_key and best.best_rank = 1
        left join value_by_position worst
          on worst.franchise_key = ft.franchise_key and worst.worst_rank = 1
       order by ft.team_name`),
  ]);

  return {
    coverage: coverageRows[0] ?? { board_seasons: [], graded_seasons: [], blocked_seasons: [] },
    bestClasses,
    worstClasses,
    steals,
    busts,
    productiveMisses,
    repeats,
    firstRoundPositions,
    positionSummary,
    franchisePositions,
  };
}

export const getDraftRecords = unstable_cache(draftRecordsRaw, ['draft-records-2026.8'], { revalidate: 3600 });