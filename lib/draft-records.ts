import 'server-only';

import { asPublic } from './db.ts';

export interface DraftClassRow {
  season: number;
  franchise_key: string;
  team_name: string;
  manager_key: string | null;
  manager: string | null;
  graded_picks: number;
  avg_value_delta: string;
  total_value_delta: number;
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
  espn_player_id: number;
  full_name: string | null;
  default_position_id: number | null;
  fantasy_points: string;
  performance_source: string;
  draft_pos_rank: number;
  production_pos_rank: number;
  value_delta: number;
}

export interface RepeatDraftRow {
  franchise_key: string;
  team_name: string;
  espn_player_id: number;
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
  bestClasses: DraftClassRow[];
  worstClasses: DraftClassRow[];
  steals: DraftPickValueRow[];
  busts: DraftPickValueRow[];
  repeats: RepeatDraftRow[];
  firstRoundPositions: FirstRoundPositionRow[];
  positionSummary: DraftPositionSummaryRow[];
  franchisePositions: FranchiseDraftPositionRow[];
}

/**
 * One comparable player-season production set across two archive eras.
 *
 * 2008-2017: legacy_draft_performance prefers ESPN's exact archived season
 * total and gap-fills players missing from the final-roster snapshot with the
 * validated nflverse reconstruction.
 *
 * 2018-2025: the weekly roster archive itself has player scoring, so sum one
 * score per player/week. max() prevents a same-week ownership edge from ever
 * counting a player's score twice.
 *
 * Draft value is deliberately relative within season+position. That makes the
 * small residual legacy reconstruction error (typically ~1 point) much less
 * important than it would be in a raw-points leaderboard and keeps a QB's point
 * scale from being compared directly with a TE's.
 */
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

export async function getDraftRecords(): Promise<DraftRecords> {
  const [
    bestClasses,
    worstClasses,
    steals,
    busts,
    repeats,
    firstRoundPositions,
    positionSummary,
    franchisePositions,
  ] = await Promise.all([
    asPublic<DraftClassRow>(`${GRADED_CTE}
      select season, franchise_key, team_name, manager_key, manager,
             count(*)::int as graded_picks,
             round(avg(value_delta)::numeric, 2)::text as avg_value_delta,
             sum(value_delta)::int as total_value_delta,
             round(sum(fantasy_points)::numeric, 1)::text as fantasy_points
        from scored
       group by season, franchise_key, team_name, manager_key, manager
      having count(*) >= 8
       order by avg(value_delta) desc, sum(value_delta) desc, season asc
       limit 10`),
    asPublic<DraftClassRow>(`${GRADED_CTE}
      select season, franchise_key, team_name, manager_key, manager,
             count(*)::int as graded_picks,
             round(avg(value_delta)::numeric, 2)::text as avg_value_delta,
             sum(value_delta)::int as total_value_delta,
             round(sum(fantasy_points)::numeric, 1)::text as fantasy_points
        from scored
       group by season, franchise_key, team_name, manager_key, manager
      having count(*) >= 8
       order by avg(value_delta) asc, sum(value_delta) asc, season asc
       limit 10`),
    asPublic<DraftPickValueRow>(`${GRADED_CTE}
      select season, overall_pick, round, round_pick, franchise_key, team_name,
             manager_key, manager, espn_player_id::int, full_name, default_position_id,
             round(fantasy_points, 1)::text as fantasy_points, performance_source,
             draft_pos_rank, production_pos_rank, value_delta
        from scored
       order by value_delta desc, fantasy_points desc, overall_pick desc
       limit 10`),
    asPublic<DraftPickValueRow>(`${GRADED_CTE}
      select season, overall_pick, round, round_pick, franchise_key, team_name,
             manager_key, manager, espn_player_id::int, full_name, default_position_id,
             round(fantasy_points, 1)::text as fantasy_points, performance_source,
             draft_pos_rank, production_pos_rank, value_delta
        from scored
       order by value_delta asc, overall_pick asc, fantasy_points asc
       limit 10`),
    asPublic<RepeatDraftRow>(`
      select tf.franchise_key,
             coalesce(f.current_name, tf.team_name) as team_name,
             d.espn_player_id::int,
             p.full_name,
             count(*)::int as times_drafted,
             string_agg(d.season::text, ', ' order by d.season) as seasons
        from public.draft_picks d
        join public.team_franchise tf
          on tf.season = d.season and tf.espn_team_id = d.espn_team_id
        left join public.franchises f using (franchise_key)
        left join public.players p using (espn_player_id)
       where d.season between 2005 and 2025
         and d.season <> 2020
       group by tf.franchise_key, coalesce(f.current_name, tf.team_name), d.espn_player_id, p.full_name
      having count(*) >= 3
       order by count(*) desc, p.full_name nulls last
       limit 12`),
    asPublic<FirstRoundPositionRow>(`
      select p.default_position_id,
             count(*)::int as picks
        from public.draft_picks d
        left join public.players p using (espn_player_id)
       where d.round = 1
         and d.season between 2005 and 2025
         and d.season <> 2020
       group by p.default_position_id
       order by count(*) desc, p.default_position_id nulls last`),
    asPublic<DraftPositionSummaryRow>(`
      with draft_base as (
        select d.season, d.overall_pick, tf.franchise_key, p.default_position_id
          from public.draft_picks d
          join public.team_franchise tf
            on tf.season = d.season and tf.espn_team_id = d.espn_team_id
          left join public.players p using (espn_player_id)
         where d.season between 2005 and 2025
           and d.season <> 2020
           and p.default_position_id is not null
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
    asPublic<FranchiseDraftPositionRow>(`${GRADED_CTE},
      draft_base as (
        select d.season, d.overall_pick, tf.franchise_key,
               coalesce(f.current_name, tf.team_name) as team_name,
               p.default_position_id
          from public.draft_picks d
          join public.team_franchise tf
            on tf.season = d.season and tf.espn_team_id = d.espn_team_id
          left join public.franchises f using (franchise_key)
          left join public.players p using (espn_player_id)
         where d.season between 2005 and 2025
           and d.season <> 2020
           and p.default_position_id is not null
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
          from scored
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
    bestClasses,
    worstClasses,
    steals,
    busts,
    repeats,
    firstRoundPositions,
    positionSummary,
    franchisePositions,
  };
}
