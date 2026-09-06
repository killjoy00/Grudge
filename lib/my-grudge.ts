import 'server-only';

import { asPublic } from './db.ts';
import {
  getCurrentSeason,
  getMyPicks,
  getPlayoffOdds,
  getStandings,
  getWeekMatchups,
  getWeekProjections,
} from './queries.ts';
import { getCurrentIncompleteWeek } from './game-context.ts';
import { getManagerGrudgeForTeams } from './rivalry-queries.ts';

export interface MyRecentMove {
  week: number;
  player_name: string;
  acquisition_type: string;
  bid_amount: string | null;
}

export interface MyGrudgeDashboard {
  season: number;
  record: {
    wins: number;
    losses: number;
    ties: number;
    points_for: string;
  } | null;
  standing_rank: number | null;
  power: {
    rank: number;
    previous_rank: number | null;
    week: number;
  } | null;
  odds: {
    playoff_pct: string;
    bye_pct: string;
    week: number;
  } | null;
  active: {
    week: number;
    locked: boolean;
    picks_made: number | null;
    picks_total: number;
    matchup_id: number | null;
    opponent_id: number | null;
    opponent_name: string | null;
    opponent_owners: string | null;
    my_projection: string | null;
    opponent_projection: string | null;
    manager_key: string | null;
    manager_name: string | null;
    opponent_manager_key: string | null;
    opponent_manager_name: string | null;
    grudge_games: number;
    grudge_wins: number;
    grudge_losses: number;
    grudge_ties: number;
  } | null;
  recent_moves: MyRecentMove[];
}

/**
 * A current-season snapshot for one team. League-wide facts use the same
 * public read paths as the rest of the site. By default `getMyPicks` also runs
 * through the signed-in RLS identity; Preview can opt out of that one private
 * read when Clerk has not been assigned to the Vercel Preview environment.
 */
export async function getMyGrudgeDashboard(
  espnTeamId: number,
  options: { includePicks?: boolean } = {}
): Promise<MyGrudgeDashboard> {
  const includePicks = options.includePicks !== false;
  const season = await getCurrentSeason();
  const activeWeek = await getCurrentIncompleteWeek(season);

  const [standings, oddsRows, rankRows, recentMoves, matchups, picks, projections] =
    await Promise.all([
      getStandings(season),
      getPlayoffOdds(season),
      asPublic<{ week: number; rank: number }>(
        `select week, rank::int as rank
           from public.power_rankings
          where season = $1 and espn_team_id = $2
          order by week desc
          limit 2`,
        [season, espnTeamId]
      ),
      asPublic<MyRecentMove>(
        `with adds as (
           select t.week,
                  (item ->> 'playerId')::bigint as espn_player_id,
                  t.type as acquisition_type,
                  t.bid_amount,
                  t.proposed_at
             from public.transactions t
             cross join lateral jsonb_array_elements(
               coalesce(t.raw -> 'items', '[]'::jsonb)
             ) item
            where t.season = $1
              and t.status = 'EXECUTED'
              and t.type in ('WAIVER', 'FREEAGENT')
              and item ->> 'type' = 'ADD'
              and (item ->> 'toTeamId')::int = $2
         )
         select a.week,
                coalesce(p.full_name, 'Unknown player') as player_name,
                a.acquisition_type,
                case
                  when a.acquisition_type = 'WAIVER'
                    then round(coalesce(a.bid_amount, 0), 2)::text
                  when coalesce(a.bid_amount, 0) > 0
                    then round(a.bid_amount, 2)::text
                  else null
                end as bid_amount
           from adds a
           left join public.players p on p.espn_player_id = a.espn_player_id
          order by a.proposed_at desc nulls last, a.week desc, player_name
          limit 5`,
        [season, espnTeamId]
      ),
      activeWeek ? getWeekMatchups(season, activeWeek.week) : Promise.resolve([]),
      activeWeek && includePicks ? getMyPicks(season, activeWeek.week) : Promise.resolve(null),
      activeWeek ? getWeekProjections(season, activeWeek.week) : Promise.resolve([]),
    ]);

  const standingIndex = standings.findIndex((row) => row.espn_team_id === espnTeamId);
  const standing = standingIndex >= 0 ? standings[standingIndex] : null;
  const odds = oddsRows.find((row) => row.espn_team_id === espnTeamId) ?? null;
  const currentRank = rankRows[0] ?? null;
  const previousRank = rankRows[1] ?? null;

  let active: MyGrudgeDashboard['active'] = null;
  if (activeWeek) {
    const matchup = matchups.find((row) =>
      row.home_team_id === espnTeamId || row.away_team_id === espnTeamId
    );
    const opponentId = matchup
      ? matchup.home_team_id === espnTeamId
        ? matchup.away_team_id
        : matchup.home_team_id
      : null;
    const opponentName = matchup
      ? matchup.home_team_id === espnTeamId
        ? matchup.away_name
        : matchup.home_name
      : null;
    const opponentOwners = matchup
      ? matchup.home_team_id === espnTeamId
        ? matchup.away_owners
        : matchup.home_owners
      : null;

    const mine = matchup
      ? projections.find((row) =>
          row.espn_matchup_id === matchup.espn_matchup_id && row.espn_team_id === espnTeamId
        )
      : null;
    const theirs = matchup && opponentId !== null
      ? projections.find((row) =>
          row.espn_matchup_id === matchup.espn_matchup_id && row.espn_team_id === opponentId
        )
      : null;

    let managerKey: string | null = null;
    let managerName: string | null = null;
    let opponentManagerKey: string | null = null;
    let opponentManagerName: string | null = null;
    let grudgeGames = 0;
    let grudgeWins = 0;
    let grudgeLosses = 0;
    let grudgeTies = 0;
    if (opponentId !== null) {
      const grudge = await getManagerGrudgeForTeams(season, espnTeamId, opponentId);
      managerKey = grudge.managerA?.manager_key ?? null;
      managerName = grudge.managerA?.display_name ?? null;
      opponentManagerKey = grudge.managerB?.manager_key ?? null;
      opponentManagerName = grudge.managerB?.display_name ?? null;
      grudgeGames = grudge.games.length;
      if (managerKey) {
        for (const game of grudge.games) {
          if (game.winner === 'TIE') {
            grudgeTies += 1;
            continue;
          }
          const winnerKey = game.winner === 'HOME' ? game.home_manager_key : game.away_manager_key;
          if (winnerKey === managerKey) grudgeWins += 1;
          else grudgeLosses += 1;
        }
      }
    }

    const lockAt = activeWeek.locks_at ?? activeWeek.first_kickoff_at;
    active = {
      week: activeWeek.week,
      locked: lockAt ? Date.parse(lockAt) <= Date.now() : true,
      picks_made: picks ? picks.length : null,
      picks_total: matchups.length,
      matchup_id: matchup?.espn_matchup_id ?? null,
      opponent_id: opponentId,
      opponent_name: opponentName,
      opponent_owners: opponentOwners,
      my_projection: mine?.projected_points ?? null,
      opponent_projection: theirs?.projected_points ?? null,
      manager_key: managerKey,
      manager_name: managerName,
      opponent_manager_key: opponentManagerKey,
      opponent_manager_name: opponentManagerName,
      grudge_games: grudgeGames,
      grudge_wins: grudgeWins,
      grudge_losses: grudgeLosses,
      grudge_ties: grudgeTies,
    };
  }

  return {
    season,
    record: standing ? {
      wins: standing.wins,
      losses: standing.losses,
      ties: standing.ties,
      points_for: standing.points_for,
    } : null,
    standing_rank: standingIndex >= 0 ? standingIndex + 1 : null,
    power: currentRank ? {
      rank: currentRank.rank,
      previous_rank: previousRank?.rank ?? null,
      week: currentRank.week,
    } : null,
    odds: odds ? {
      playoff_pct: odds.playoff_pct,
      bye_pct: odds.bye_pct,
      week: odds.week,
    } : null,
    active,
    recent_moves: recentMoves,
  };
}
