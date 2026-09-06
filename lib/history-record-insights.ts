import 'server-only';

import { asPublic } from './db.ts';

export interface PowerChampionRow {
  season: number;
  week: number;
  espn_team_id: number;
  franchise_key: string;
  team_name: string;
  manager_key: string | null;
  manager: string | null;
  rank: number;
  score: string;
}

/** The #1 team in the final current-formula power ranking of every played season. */
export async function getPowerRankingChampions() {
  return asPublic<PowerChampionRow>(
    `select p.season, p.week, p.espn_team_id, fs.franchise_key, fs.team_name,
            m.manager_key, m.display_name as manager,
            p.rank::int, round(p.score, 4)::text as score
       from public.power_rankings p
       join public.seasons s
         on s.season = p.season and p.week = s.regular_season_weeks
       join public.franchise_seasons fs
         on fs.season = p.season and fs.espn_team_id = p.espn_team_id
       left join public.manager_franchise_seasons ms
         on ms.season = fs.season and ms.franchise_key = fs.franchise_key and ms.is_primary
       left join public.managers m using (manager_key)
      where p.rank = 1
      order by p.season desc`
  );
}

export interface PowerSeasonRecordRow {
  season: number;
  week: number;
  espn_team_id: number;
  franchise_key: string;
  team_name: string;
  manager_key: string | null;
  manager: string | null;
  wins: number;
  losses: number;
  ties: number;
  final_place: number | null;
  is_champion: boolean;
  playoff_team_count: number;
  rank: number;
  score: string;
}

/**
 * Every team's final regular-season power score, on one comparable scale.
 * The stored score uses the site's normal 40/30/20/10 power formula and is
 * explicitly taken at each season's regular-season boundary.
 */
export async function getFinalPowerSeasonRecords() {
  return asPublic<PowerSeasonRecordRow>(
    `select p.season, p.week, p.espn_team_id,
            fs.franchise_key, fs.team_name,
            m.manager_key, m.display_name as manager,
            fs.regular_wins as wins, fs.regular_losses as losses, fs.regular_ties as ties,
            fs.final_place, fs.is_champion,
            s.playoff_team_count,
            p.rank::int, round(p.score, 4)::text as score
       from public.power_rankings p
       join public.seasons s
         on s.season = p.season and p.week = s.regular_season_weeks
       join public.franchise_seasons fs
         on fs.season = p.season and fs.espn_team_id = p.espn_team_id
       left join public.manager_franchise_seasons ms
         on ms.season = fs.season and ms.franchise_key = fs.franchise_key and ms.is_primary
       left join public.managers m using (manager_key)
      order by p.score desc, p.season asc, p.rank asc`
  );
}

export interface SeasonLuckRecordRow {
  season: number;
  espn_team_id: number;
  franchise_key: string;
  team_name: string;
  manager_key: string | null;
  manager: string | null;
  actual_wins: number;
  expected_wins: string;
  luck_delta: string;
}

async function getSeasonLuckRecords(direction: 'asc' | 'desc', limit: number) {
  const order = direction === 'desc' ? 'l.luck_delta desc' : 'l.luck_delta asc';
  return asPublic<SeasonLuckRecordRow>(
    `with final_weeks as (
       select season, max(week)::int as week
         from public.luck_index
        group by season
     )
     select l.season, l.espn_team_id, fs.franchise_key, fs.team_name,
            m.manager_key, m.display_name as manager,
            l.actual_wins::int,
            round(l.expected_wins, 2)::text as expected_wins,
            round(l.luck_delta, 2)::text as luck_delta
       from final_weeks fw
       join public.luck_index l on l.season = fw.season and l.week = fw.week
       join public.franchise_seasons fs
         on fs.season = l.season and fs.espn_team_id = l.espn_team_id
       left join public.manager_franchise_seasons ms
         on ms.season = fs.season and ms.franchise_key = fs.franchise_key and ms.is_primary
       left join public.managers m using (manager_key)
      order by ${order}, l.season asc
      limit $1`,
    [limit]
  );
}

export const getLuckiestSeasons = (limit = 10) => getSeasonLuckRecords('desc', limit);
export const getUnluckiestSeasons = (limit = 10) => getSeasonLuckRecords('asc', limit);
