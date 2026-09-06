import 'server-only';

import { asPublic } from './db.ts';
import { canonicalEspnTeamIdSql } from './franchise-identity.ts';
import { trackedMatchupSql } from './playoff-policy.ts';
import type { RivalryPairRow } from './rivalry-leaderboard.ts';

export interface FranchiseRivalry {
  opp_id: number;
  name: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  avg_points_for: string;
  first_season: number;
  last_season: number;
}

/**
 * All tracked meetings for one durable franchise: regular season plus only the
 * championship playoff bracket. Consolation placement games are deliberately
 * excluded from rivalry records.
 */
export async function getFranchiseRivalries(teamId: number) {
  const homeFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.home_team_id');
  const awayFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.away_team_id');
  const tracked = trackedMatchupSql('m');

  return asPublic<FranchiseRivalry>(
    `with sides as (
       select m.season,
              ${homeFranchiseId}::int as team_id,
              ${awayFranchiseId}::int as opp_id,
              m.home_points as pf,
              m.winner = 'HOME' as won,
              m.winner = 'TIE' as tied
         from public.matchups m
        where m.is_final and m.home_points is not null and m.away_points is not null and ${tracked}
       union all
       select m.season,
              ${awayFranchiseId}::int as team_id,
              ${homeFranchiseId}::int as opp_id,
              m.away_points as pf,
              m.winner = 'AWAY' as won,
              m.winner = 'TIE' as tied
         from public.matchups m
        where m.is_final and m.home_points is not null and m.away_points is not null and ${tracked}
     ), totals as (
       select opp_id,
              count(*)::int as games,
              count(*) filter (where won)::int as wins,
              count(*) filter (where tied)::int as ties,
              count(*) filter (where not won and not tied)::int as losses,
              round(avg(pf), 2)::text as avg_points_for,
              min(season)::int as first_season,
              max(season)::int as last_season
         from sides
        where team_id = $1
        group by opp_id
     )
     select h.opp_id, t.name, h.games, h.wins, h.losses, h.ties,
            h.avg_points_for, h.first_season, h.last_season
       from totals h
       join public.teams t
         on t.espn_team_id = h.opp_id
        and t.season = (select max(season) from public.teams)
      order by h.games desc, h.wins desc`,
    [teamId]
  );
}

/** One row per unordered durable-franchise pairing across the tracked ledger. */
export async function getAllTimeRivalryPairs() {
  const homeFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.home_team_id');
  const awayFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.away_team_id');
  const tracked = trackedMatchupSql('m');

  return asPublic<RivalryPairRow>(
    `with games as (
       select m.season,
              ${homeFranchiseId}::int as home_id,
              ${awayFranchiseId}::int as away_id,
              case
                when m.winner = 'TIE' then null
                when m.winner = 'HOME' then ${homeFranchiseId}::int
                else ${awayFranchiseId}::int
              end as winner_id,
              nullif(m.playoff_tier, 'NONE') as playoff_tier
         from public.matchups m
        where m.is_final and m.home_points is not null and m.away_points is not null and ${tracked}
     ), pairs as (
       select season,
              least(home_id, away_id)::int as team_a_id,
              greatest(home_id, away_id)::int as team_b_id,
              winner_id, playoff_tier
         from games
     ), totals as (
       select team_a_id, team_b_id,
              count(*)::int as games,
              count(*) filter (where winner_id = team_a_id)::int as team_a_wins,
              count(*) filter (where winner_id = team_b_id)::int as team_b_wins,
              count(*) filter (where winner_id is null)::int as ties,
              count(*) filter (where playoff_tier is not null)::int as playoff_games,
              count(*) filter (where playoff_tier is not null and winner_id = team_a_id)::int as team_a_playoff_wins,
              count(*) filter (where playoff_tier is not null and winner_id = team_b_id)::int as team_b_playoff_wins,
              min(season)::int as first_season,
              max(season)::int as last_season
         from pairs
        group by team_a_id, team_b_id
     )
     select x.team_a_id, ta.name as team_a_name,
            x.team_b_id, tb.name as team_b_name,
            x.games, x.team_a_wins, x.team_b_wins, x.ties,
            x.playoff_games, x.team_a_playoff_wins, x.team_b_playoff_wins,
            x.first_season, x.last_season
       from totals x
       join public.teams ta
         on ta.espn_team_id = x.team_a_id
        and ta.season = (select max(season) from public.teams)
       join public.teams tb
         on tb.espn_team_id = x.team_b_id
        and tb.season = (select max(season) from public.teams)
      order by x.games desc, abs(x.team_a_wins - x.team_b_wins), ta.name, tb.name`
  );
}

export interface HighestScoringRivalryGame {
  season: number;
  week: number;
  espn_matchup_id: number;
  home_team_id: number;
  away_team_id: number;
  home_name: string;
  away_name: string;
  home_points: string;
  away_points: string;
  total_points: string;
  playoff_tier: string | null;
}

/** The highest combined score in any tracked head-to-head game on file. */
export async function getHighestScoringRivalryGame() {
  const homeFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.home_team_id');
  const awayFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.away_team_id');
  const tracked = trackedMatchupSql('m');
  const rows = await asPublic<HighestScoringRivalryGame>(
    `select m.season, m.week, m.espn_matchup_id,
            ${homeFranchiseId}::int as home_team_id,
            ${awayFranchiseId}::int as away_team_id,
            ht.name as home_name, at.name as away_name,
            round(m.home_points, 2)::text as home_points,
            round(m.away_points, 2)::text as away_points,
            round(m.home_points + m.away_points, 2)::text as total_points,
            nullif(m.playoff_tier, 'NONE') as playoff_tier
       from public.matchups m
       join public.teams ht
         on ht.season = m.season and ht.espn_team_id = m.home_team_id
       join public.teams at
         on at.season = m.season and at.espn_team_id = m.away_team_id
      where m.is_final and m.home_points is not null and m.away_points is not null and ${tracked}
      order by m.home_points + m.away_points desc, m.season, m.week, m.espn_matchup_id
      limit 1`
  );
  return rows[0] ?? null;
}
