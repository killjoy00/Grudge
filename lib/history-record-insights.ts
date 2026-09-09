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
    `select p.season, p.week, p.espn_team_id, fst.franchise_key, fst.team_name,
            m.manager_key, m.display_name as manager,
            p.rank::int, round(p.score, 4)::text as score
       from public.power_rankings p
       join public.seasons s
         on s.season = p.season and p.week = s.regular_season_weeks
       join public.franchise_season_teams fst
         on fst.season = p.season and fst.espn_team_id = p.espn_team_id
       left join public.manager_franchise_seasons ms
         on ms.season = fst.season and ms.franchise_key = fst.franchise_key and ms.is_primary
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
 * Identity comes from the franchise-season mapping; settled finish data is an
 * optional overlay so a season can reach its regular-season boundary first.
 */
export async function getFinalPowerSeasonRecords() {
  return asPublic<PowerSeasonRecordRow>(
    `select p.season, p.week, p.espn_team_id,
            fst.franchise_key, fst.team_name,
            m.manager_key, m.display_name as manager,
            coalesce(r.regular_wins, live.cum_wins, 0)::int as wins,
            coalesce(r.regular_losses, live.cum_losses, 0)::int as losses,
            coalesce(r.regular_ties, live.cum_ties, 0)::int as ties,
            r.final_place, coalesce(r.is_champion, false) as is_champion,
            s.playoff_team_count,
            p.rank::int, round(p.score, 4)::text as score
       from public.power_rankings p
       join public.seasons s
         on s.season = p.season and p.week = s.regular_season_weeks
       join public.franchise_season_teams fst
         on fst.season = p.season and fst.espn_team_id = p.espn_team_id
       left join public.franchise_season_results r
         on r.season = fst.season and r.franchise_key = fst.franchise_key
       left join lateral (
         select twr.cum_wins, twr.cum_losses, twr.cum_ties
           from public.team_week_results twr
          where twr.season = fst.season and twr.espn_team_id = fst.espn_team_id
          order by twr.week desc limit 1
       ) live on true
       left join public.manager_franchise_seasons ms
         on ms.season = fst.season and ms.franchise_key = fst.franchise_key and ms.is_primary
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
     select l.season, l.espn_team_id, fst.franchise_key, fst.team_name,
            m.manager_key, m.display_name as manager,
            l.actual_wins::int,
            round(l.expected_wins, 2)::text as expected_wins,
            round(l.luck_delta, 2)::text as luck_delta
       from final_weeks fw
       join public.luck_index l on l.season = fw.season and l.week = fw.week
       join public.franchise_season_teams fst
         on fst.season = l.season and fst.espn_team_id = l.espn_team_id
       left join public.manager_franchise_seasons ms
         on ms.season = fst.season and ms.franchise_key = fst.franchise_key and ms.is_primary
       left join public.managers m using (manager_key)
      order by ${order}, l.season asc
      limit $1`,
    [limit]
  );
}

export const getLuckiestSeasons = (limit = 10) => getSeasonLuckRecords('desc', limit);
export const getUnluckiestSeasons = (limit = 10) => getSeasonLuckRecords('asc', limit);
