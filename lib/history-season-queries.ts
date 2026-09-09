import 'server-only';

import { asPublic } from './db.ts';

export interface HistorySeasonStandingRow {
  franchise_key: string;
  current_name: string;
  team_name: string;
  espn_team_id: number | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: string | null;
  points_against: string | null;
  playoff_wins: number;
  playoff_losses: number;
  final_place: number | null;
  is_champion: boolean;
  is_runner_up: boolean;
  source: string;
  is_settled: boolean;
}

/**
 * History season identity exists before a season result does. For an unsettled
 * season, overlay the latest weekly cumulative record onto the canonical
 * franchise-season mapping instead of making /history/:season disappear.
 */
export async function getHistorySeasonStandings(season: number) {
  return asPublic<HistorySeasonStandingRow>(
    `select fst.franchise_key, f.current_name, fst.team_name, fst.espn_team_id,
            coalesce(r.regular_wins, live.cum_wins, 0)::int as wins,
            coalesce(r.regular_losses, live.cum_losses, 0)::int as losses,
            coalesce(r.regular_ties, live.cum_ties, 0)::int as ties,
            case when r.season is not null then round(r.regular_points_for, 1)::text
                 when live.week is not null then round(live.cum_points_for, 1)::text end as points_for,
            case when r.season is not null then round(r.regular_points_against, 1)::text
                 when live.week is not null then round(live.cum_points_against, 1)::text end as points_against,
            coalesce(r.playoff_wins, 0)::int as playoff_wins,
            coalesce(r.playoff_losses, 0)::int as playoff_losses,
            r.final_place,
            coalesce(r.is_champion, false) as is_champion,
            coalesce(r.is_runner_up, false) as is_runner_up,
            coalesce(r.source, 'live') as source,
            r.season is not null as is_settled
       from public.franchise_season_teams fst
       join public.franchises f using(franchise_key)
       left join public.franchise_season_results r
         on r.season = fst.season and r.franchise_key = fst.franchise_key
       left join lateral (
         select twr.week, twr.cum_wins, twr.cum_losses, twr.cum_ties,
                twr.cum_points_for, twr.cum_points_against
           from public.team_week_results twr
          where twr.season = fst.season and twr.espn_team_id = fst.espn_team_id
          order by twr.week desc
          limit 1
       ) live on true
      where fst.season = $1
      order by (coalesce(r.regular_wins, live.cum_wins, 0)
                 + coalesce(r.regular_ties, live.cum_ties, 0) / 2.0)
                 / nullif(coalesce(r.regular_wins, live.cum_wins, 0)
                         + coalesce(r.regular_losses, live.cum_losses, 0)
                         + coalesce(r.regular_ties, live.cum_ties, 0), 0) desc nulls last,
               coalesce(r.regular_points_for, live.cum_points_for) desc nulls last,
               fst.team_name`,
    [season]
  );
}

export interface HistoryPlayoffGameRow {
  season: number;
  week: number;
  espn_matchup_id: number;
  home_team_id: number;
  home_key: string;
  home_name: string;
  home_points: string;
  away_team_id: number;
  away_key: string;
  away_name: string;
  away_points: string;
  winner: string;
}

/** Playoff game identity is season-scoped and must not depend on settled results. */
export async function getHistorySeasonPlayoffGames(season: number) {
  return asPublic<HistoryPlayoffGameRow>(
    `select m.season, m.week, m.espn_matchup_id,
            m.home_team_id, hf.franchise_key as home_key, hf.team_name as home_name,
            round(m.home_points, 1)::text as home_points,
            m.away_team_id, af.franchise_key as away_key, af.team_name as away_name,
            round(m.away_points, 1)::text as away_points,
            m.winner
       from public.matchups m
       join public.franchise_season_teams hf
         on hf.season = m.season and hf.espn_team_id = m.home_team_id
       join public.franchise_season_teams af
         on af.season = m.season and af.espn_team_id = m.away_team_id
      where m.season = $1 and m.is_final
        and m.playoff_tier = 'WINNERS_BRACKET'
        and m.home_points is not null and m.away_points is not null
      order by m.week, m.espn_matchup_id`,
    [season]
  );
}
