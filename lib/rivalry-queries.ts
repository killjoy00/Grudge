import 'server-only';

import { asPublic } from './db.ts';
import { trackedMatchupSql } from './playoff-policy.ts';
import type { RivalryPairRow } from './rivalry-leaderboard.ts';

export interface ManagerGrudge {
  opp_key: string;
  name: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  playoff_games: number;
  playoff_wins: number;
  playoff_losses: number;
  avg_points_for: string;
  first_season: number;
  last_season: number;
}

/**
 * Manager-vs-manager history follows people across franchise changes. Each game
 * is attributed to the primary manager assigned to that franchise for that
 * season. The tracked-game predicate excludes every post-regular-season game
 * except the championship bracket.
 */
export async function getManagerGrudges(managerKey: string) {
  const tracked = trackedMatchupSql('m');
  return asPublic<ManagerGrudge>(
    `with games as (
       select m.season, m.playoff_tier,
              hms.manager_key as home_manager_key,
              ams.manager_key as away_manager_key,
              m.home_points, m.away_points, m.winner
         from public.matchups m
         join public.franchise_seasons hfs
           on hfs.season = m.season and hfs.espn_team_id = m.home_team_id
         join public.franchise_seasons afs
           on afs.season = m.season and afs.espn_team_id = m.away_team_id
         join public.manager_franchise_seasons hms
           on hms.season = hfs.season and hms.franchise_key = hfs.franchise_key and hms.is_primary
         join public.manager_franchise_seasons ams
           on ams.season = afs.season and ams.franchise_key = afs.franchise_key and ams.is_primary
        where m.is_final and m.home_points is not null and m.away_points is not null
          and hms.manager_key <> ams.manager_key
          and ${tracked}
     ), sides as (
       select season, home_manager_key as manager_key, away_manager_key as opp_key,
              home_points as pf,
              winner = 'HOME' as won, winner = 'TIE' as tied,
              playoff_tier = 'WINNERS_BRACKET' as playoff
         from games
       union all
       select season, away_manager_key, home_manager_key,
              away_points,
              winner = 'AWAY', winner = 'TIE',
              playoff_tier = 'WINNERS_BRACKET'
         from games
     ), totals as (
       select opp_key,
              count(*)::int as games,
              count(*) filter (where won)::int as wins,
              count(*) filter (where tied)::int as ties,
              count(*) filter (where not won and not tied)::int as losses,
              count(*) filter (where playoff)::int as playoff_games,
              count(*) filter (where playoff and won)::int as playoff_wins,
              count(*) filter (where playoff and not won and not tied)::int as playoff_losses,
              round(avg(pf), 2)::text as avg_points_for,
              min(season)::int as first_season,
              max(season)::int as last_season
         from sides
        where manager_key = $1
        group by opp_key
     )
     select x.opp_key, m.display_name as name,
            x.games, x.wins, x.losses, x.ties,
            x.playoff_games, x.playoff_wins, x.playoff_losses,
            x.avg_points_for, x.first_season, x.last_season
       from totals x
       join public.managers m on m.manager_key = x.opp_key
      order by x.games desc, x.wins desc, m.display_name`,
    [managerKey]
  );
}

/** One row per unordered manager pairing across the tracked ledger. */
export async function getAllTimeRivalryPairs() {
  const tracked = trackedMatchupSql('m');
  return asPublic<RivalryPairRow>(
    `with games as (
       select m.season,
              hms.manager_key as home_manager_key,
              ams.manager_key as away_manager_key,
              case
                when m.winner = 'TIE' then null
                when m.winner = 'HOME' then hms.manager_key
                else ams.manager_key
              end as winner_key,
              m.playoff_tier = 'WINNERS_BRACKET' as playoff
         from public.matchups m
         join public.franchise_seasons hfs
           on hfs.season = m.season and hfs.espn_team_id = m.home_team_id
         join public.franchise_seasons afs
           on afs.season = m.season and afs.espn_team_id = m.away_team_id
         join public.manager_franchise_seasons hms
           on hms.season = hfs.season and hms.franchise_key = hfs.franchise_key and hms.is_primary
         join public.manager_franchise_seasons ams
           on ams.season = afs.season and ams.franchise_key = afs.franchise_key and ams.is_primary
        where m.is_final and m.home_points is not null and m.away_points is not null
          and hms.manager_key <> ams.manager_key
          and ${tracked}
     ), pairs as (
       select season,
              least(home_manager_key, away_manager_key) as manager_a_key,
              greatest(home_manager_key, away_manager_key) as manager_b_key,
              winner_key, playoff
         from games
     ), totals as (
       select manager_a_key, manager_b_key,
              count(*)::int as games,
              count(*) filter (where winner_key = manager_a_key)::int as manager_a_wins,
              count(*) filter (where winner_key = manager_b_key)::int as manager_b_wins,
              count(*) filter (where winner_key is null)::int as ties,
              count(*) filter (where playoff)::int as playoff_games,
              count(*) filter (where playoff and winner_key = manager_a_key)::int as manager_a_playoff_wins,
              count(*) filter (where playoff and winner_key = manager_b_key)::int as manager_b_playoff_wins,
              min(season)::int as first_season,
              max(season)::int as last_season
         from pairs
        group by manager_a_key, manager_b_key
     )
     select x.manager_a_key, ma.display_name as manager_a_name,
            x.manager_b_key, mb.display_name as manager_b_name,
            x.games, x.manager_a_wins, x.manager_b_wins, x.ties,
            x.playoff_games, x.manager_a_playoff_wins, x.manager_b_playoff_wins,
            x.first_season, x.last_season
       from totals x
       join public.managers ma on ma.manager_key = x.manager_a_key
       join public.managers mb on mb.manager_key = x.manager_b_key
      order by x.games desc, abs(x.manager_a_wins - x.manager_b_wins), ma.display_name, mb.display_name`
  );
}

export interface HighestScoringRivalryGame {
  season: number;
  week: number;
  espn_matchup_id: number;
  home_manager_key: string;
  home_manager_name: string;
  away_manager_key: string;
  away_manager_name: string;
  home_team_name: string;
  away_team_name: string;
  home_points: string;
  away_points: string;
  total_points: string;
  playoff_tier: string | null;
}

/** The highest combined score in any tracked manager-vs-manager game. */
export async function getHighestScoringRivalryGame() {
  const tracked = trackedMatchupSql('m');
  const rows = await asPublic<HighestScoringRivalryGame>(
    `select m.season, m.week, m.espn_matchup_id,
            hms.manager_key as home_manager_key, hm.display_name as home_manager_name,
            ams.manager_key as away_manager_key, am.display_name as away_manager_name,
            hfs.team_name as home_team_name, afs.team_name as away_team_name,
            round(m.home_points, 2)::text as home_points,
            round(m.away_points, 2)::text as away_points,
            round(m.home_points + m.away_points, 2)::text as total_points,
            case when m.playoff_tier = 'WINNERS_BRACKET' then m.playoff_tier else null end as playoff_tier
       from public.matchups m
       join public.franchise_seasons hfs
         on hfs.season = m.season and hfs.espn_team_id = m.home_team_id
       join public.franchise_seasons afs
         on afs.season = m.season and afs.espn_team_id = m.away_team_id
       join public.manager_franchise_seasons hms
         on hms.season = hfs.season and hms.franchise_key = hfs.franchise_key and hms.is_primary
       join public.manager_franchise_seasons ams
         on ams.season = afs.season and ams.franchise_key = afs.franchise_key and ams.is_primary
       join public.managers hm on hm.manager_key = hms.manager_key
       join public.managers am on am.manager_key = ams.manager_key
      where m.is_final and m.home_points is not null and m.away_points is not null
        and hms.manager_key <> ams.manager_key
        and ${tracked}
      order by m.home_points + m.away_points desc, m.season, m.week, m.espn_matchup_id
      limit 1`
  );
  return rows[0] ?? null;
}

export interface ManagerTeamIdentity {
  manager_key: string;
  display_name: string;
  franchise_key: string;
  team_name: string;
  espn_team_id: number;
}

/**
 * Resolve the manager controlling a team in the requested season.
 *
 * Completed history uses exact season mappings elsewhere. This helper is for
 * current matchup context, where the current season can exist in `teams`
 * before result-derived `franchise_seasons` and the new manager-tenure rows are
 * loaded. `team_franchise` already resolves that preseason identity safely;
 * prefer an exact-season manager mapping, otherwise carry forward the latest
 * primary manager recorded for that same durable franchise.
 */
export async function getManagerForTeamSeason(season: number, espnTeamId: number) {
  const rows = await asPublic<ManagerTeamIdentity>(
    `select m.manager_key, m.display_name,
            tf.franchise_key, tf.team_name, tf.espn_team_id
       from public.team_franchise tf
       join lateral (
         select ms.manager_key
           from public.manager_franchise_seasons ms
          where ms.franchise_key = tf.franchise_key
            and ms.is_primary
            and ms.season <= $1
          order by case when ms.season = $1 then 0 else 1 end,
                   ms.season desc
          limit 1
       ) resolved on true
       join public.managers m on m.manager_key = resolved.manager_key
      where tf.season = $1 and tf.espn_team_id = $2
      limit 1`,
    [season, espnTeamId]
  );
  return rows[0] ?? null;
}

export interface ManagerGrudgeGame {
  season: number;
  week: number;
  espn_matchup_id: number;
  home_manager_key: string;
  home_manager_name: string;
  home_team_id: number;
  home_team_name: string;
  away_manager_key: string;
  away_manager_name: string;
  away_team_id: number;
  away_team_name: string;
  home_points: string | null;
  away_points: string | null;
  winner: string;
  playoff_tier: string | null;
  /** 1 = championship, 2 = semifinal, 3 = first round. Null in regular season. */
  playoff_rounds_from_final: number | null;
}

export interface ManagerIdentity {
  manager_key: string;
  display_name: string;
}

export async function getManagerGrudgeSeries(managerA: string, managerB: string) {
  const tracked = trackedMatchupSql('m');
  const [managers, games] = await Promise.all([
    asPublic<ManagerIdentity>(
      `select manager_key, display_name
         from public.managers
        where manager_key in ($1, $2)
        order by display_name`,
      [managerA, managerB]
    ),
    asPublic<ManagerGrudgeGame>(
      `with playoff_weeks as (
         select season, week,
                dense_rank() over (partition by season order by week desc)::int as rounds_from_final
           from (
             select distinct season, week
               from public.matchups
              where playoff_tier = 'WINNERS_BRACKET'
           ) x
       )
       select m.season, m.week, m.espn_matchup_id,
              hms.manager_key as home_manager_key, hm.display_name as home_manager_name,
              m.home_team_id, hfs.team_name as home_team_name,
              ams.manager_key as away_manager_key, am.display_name as away_manager_name,
              m.away_team_id, afs.team_name as away_team_name,
              round(m.home_points, 2)::text as home_points,
              round(m.away_points, 2)::text as away_points,
              m.winner,
              case when m.playoff_tier = 'WINNERS_BRACKET' then m.playoff_tier else null end as playoff_tier,
              pw.rounds_from_final as playoff_rounds_from_final
         from public.matchups m
         join public.franchise_seasons hfs
           on hfs.season = m.season and hfs.espn_team_id = m.home_team_id
         join public.franchise_seasons afs
           on afs.season = m.season and afs.espn_team_id = m.away_team_id
         join public.manager_franchise_seasons hms
           on hms.season = hfs.season and hms.franchise_key = hfs.franchise_key and hms.is_primary
         join public.manager_franchise_seasons ams
           on ams.season = afs.season and ams.franchise_key = afs.franchise_key and ams.is_primary
         join public.managers hm on hm.manager_key = hms.manager_key
         join public.managers am on am.manager_key = ams.manager_key
         left join playoff_weeks pw
           on pw.season = m.season and pw.week = m.week and m.playoff_tier = 'WINNERS_BRACKET'
        where m.is_final and m.home_points is not null and m.away_points is not null
          and ${tracked}
          and ((hms.manager_key = $1 and ams.manager_key = $2)
            or (hms.manager_key = $2 and ams.manager_key = $1))
        order by m.season desc, m.week desc, m.espn_matchup_id desc`,
      [managerA, managerB]
    ),
  ]);
  return { managers, games };
}

export async function getManagerGrudgeForTeams(
  season: number,
  teamA: number,
  teamB: number
) {
  const [managerA, managerB] = await Promise.all([
    getManagerForTeamSeason(season, teamA),
    getManagerForTeamSeason(season, teamB),
  ]);
  if (!managerA || !managerB || managerA.manager_key === managerB.manager_key) {
    return { managerA, managerB, games: [] as ManagerGrudgeGame[] };
  }
  const { games } = await getManagerGrudgeSeries(managerA.manager_key, managerB.manager_key);
  return { managerA, managerB, games };
}
