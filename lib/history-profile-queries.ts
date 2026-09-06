import 'server-only';

import { asPublic } from './db.ts';
import { trackedMatchupSql } from './playoff-policy.ts';

export interface HistorySeasonMetric {
  season: number;
  power_rank: number | null;
  power_score: string | null;
  luck_delta: string | null;
  expected_wins: string | null;
}

const SEASON_METRIC_SELECT = `
  select fs.season,
         p.rank::int as power_rank,
         case when p.score is null then null else round(p.score, 4)::text end as power_score,
         case when l.luck_delta is null then null else round(l.luck_delta, 3)::text end as luck_delta,
         case when l.expected_wins is null then null else round(l.expected_wins, 3)::text end as expected_wins
    from public.franchise_seasons fs
    left join lateral (
      select pr.rank, pr.score
        from public.power_rankings pr
       where pr.season = fs.season and pr.espn_team_id = fs.espn_team_id
       order by pr.week desc limit 1
    ) p on true
    left join lateral (
      select li.luck_delta, li.expected_wins
        from public.luck_index li
       where li.season = fs.season and li.espn_team_id = fs.espn_team_id
       order by li.week desc limit 1
    ) l on true`;

export async function getFranchiseSeasonMetrics(franchiseKey: string) {
  return asPublic<HistorySeasonMetric>(
    `${SEASON_METRIC_SELECT}
      where fs.franchise_key = $1
      order by fs.season desc`,
    [franchiseKey]
  );
}

export async function getManagerSeasonMetrics(managerKey: string) {
  return asPublic<HistorySeasonMetric>(
    `${SEASON_METRIC_SELECT}
      join public.manager_franchise_seasons ms
        on ms.season = fs.season and ms.franchise_key = fs.franchise_key and ms.is_primary
      where ms.manager_key = $1
      order by fs.season desc`,
    [managerKey]
  );
}

export interface HistoryGameMoment {
  kind: 'highest_score' | 'biggest_win' | 'closest_game';
  season: number;
  week: number;
  team_name: string;
  opponent_name: string;
  points_for: string;
  points_against: string;
  margin: string;
  playoff_tier: string | null;
}

function momentsQuery(targetJoin: string, targetWhere: string) {
  const tracked = trackedMatchupSql('m');
  return `with sides as (
    select m.season, m.week, m.playoff_tier,
           m.home_team_id as espn_team_id, m.away_team_id as opponent_team_id,
           m.home_points as points_for, m.away_points as points_against,
           case m.winner when 'HOME' then 'W' when 'AWAY' then 'L' else 'T' end as result
      from public.matchups m
     where m.is_final and m.home_points is not null and m.away_points is not null and ${tracked}
    union all
    select m.season, m.week, m.playoff_tier,
           m.away_team_id, m.home_team_id,
           m.away_points, m.home_points,
           case m.winner when 'AWAY' then 'W' when 'HOME' then 'L' else 'T' end
      from public.matchups m
     where m.is_final and m.home_points is not null and m.away_points is not null and ${tracked}
  ), target as (
    select x.*, fs.franchise_key, fs.team_name, ofs.team_name as opponent_name
      from sides x
      join public.franchise_seasons fs
        on fs.season = x.season and fs.espn_team_id = x.espn_team_id
      join public.franchise_seasons ofs
        on ofs.season = x.season and ofs.espn_team_id = x.opponent_team_id
      ${targetJoin}
     where ${targetWhere}
  ), moments as (
    (select 'highest_score'::text as kind, * from target
      order by points_for desc, season asc, week asc limit 1)
    union all
    (select 'biggest_win'::text as kind, * from target where result = 'W'
      order by (points_for - points_against) desc, season asc, week asc limit 1)
    union all
    (select 'closest_game'::text as kind, * from target
      order by abs(points_for - points_against) asc, season asc, week asc limit 1)
  )
  select kind, season, week, team_name, opponent_name,
         round(points_for, 1)::text as points_for,
         round(points_against, 1)::text as points_against,
         round(points_for - points_against, 1)::text as margin,
         nullif(playoff_tier, 'NONE') as playoff_tier
    from moments
   order by case kind when 'highest_score' then 1 when 'biggest_win' then 2 else 3 end`;
}

export async function getFranchiseGameMoments(franchiseKey: string) {
  return asPublic<HistoryGameMoment>(
    momentsQuery('', 'fs.franchise_key = $1'),
    [franchiseKey]
  );
}

export async function getManagerGameMoments(managerKey: string) {
  return asPublic<HistoryGameMoment>(
    momentsQuery(
      `join public.manager_franchise_seasons ms
         on ms.season = fs.season and ms.franchise_key = fs.franchise_key and ms.is_primary`,
      'ms.manager_key = $1'
    ),
    [managerKey]
  );
}

export async function getManagerRegularSeasonTitleSeasons(managerKey: string) {
  return asPublic<{ season: number; franchise_key: string; team_name: string }>(
    `with ranked as (
       select fs.*,
              row_number() over (
                partition by fs.season
                order by (fs.regular_wins + fs.regular_ties / 2.0)
                         / nullif(fs.regular_wins + fs.regular_losses + fs.regular_ties, 0) desc,
                         fs.regular_points_for desc
              ) as rn
         from public.franchise_seasons fs
     )
     select r.season, r.franchise_key, r.team_name
       from ranked r
       join public.manager_franchise_seasons ms
         on ms.season = r.season and ms.franchise_key = r.franchise_key and ms.is_primary
      where r.rn = 1 and ms.manager_key = $1
      order by r.season desc`,
    [managerKey]
  );
}
