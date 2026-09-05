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

export interface DraftRecords {
  bestClasses: DraftClassRow[];
  worstClasses: DraftClassRow[];
  steals: DraftPickValueRow[];
  busts: DraftPickValueRow[];
  repeats: RepeatDraftRow[];
  firstRoundPositions: FirstRoundPositionRow[];
}

const GRADED_CTE = `
with weekly as (
  select r.season, r.week, r.espn_player_id,
         max(r.applied_points)::numeric as points
    from public.roster_entries r
    join public.weeks w
      on w.season = r.season and w.week = r.week and w.results_complete
   where r.season between 2018 and 2025
   group by r.season, r.week, r.espn_player_id
), production as (
  select season, espn_player_id, sum(points)::numeric as fantasy_points
    from weekly
   group by season, espn_player_id
), base as (
  select d.season, d.overall_pick, d.round, d.round_pick,
         d.espn_team_id, d.espn_player_id,
         p.full_name, p.default_position_id,
         coalesce(pr.fantasy_points, 0)::numeric as fantasy_points,
         tf.franchise_key, tf.team_name,
         m.manager_key, m.display_name as manager
    from public.draft_picks d
    join public.players p using (espn_player_id)
    join public.team_franchise tf
      on tf.season = d.season and tf.espn_team_id = d.espn_team_id
    left join production pr using (season, espn_player_id)
    left join public.manager_franchise_seasons ms
      on ms.season = tf.season and ms.franchise_key = tf.franchise_key and ms.is_primary
    left join public.managers m using (manager_key)
   where d.season between 2018 and 2025
     and d.season <> 2020
     and coalesce(p.default_position_id, -1) not in (5, 16)
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
  const [bestClasses, worstClasses, steals, busts, repeats, firstRoundPositions] = await Promise.all([
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
             round(fantasy_points, 1)::text as fantasy_points,
             draft_pos_rank, production_pos_rank, value_delta
        from scored
       order by value_delta desc, fantasy_points desc, overall_pick desc
       limit 10`),
    asPublic<DraftPickValueRow>(`${GRADED_CTE}
      select season, overall_pick, round, round_pick, franchise_key, team_name,
             manager_key, manager, espn_player_id::int, full_name, default_position_id,
             round(fantasy_points, 1)::text as fantasy_points,
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
  ]);

  return { bestClasses, worstClasses, steals, busts, repeats, firstRoundPositions };
}
