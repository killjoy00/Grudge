import 'server-only';

import { asPublic } from './db.ts';
import { canonicalEspnTeamIdSql } from './franchise-identity.ts';

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
 * All finalized meetings for one durable franchise, playoffs included.
 *
 * This intentionally reads matchups instead of public.head_to_head because the
 * legacy ESPN recovery proved one raw team-id handoff: CTE was team 7 in 2005
 * and team 10 thereafter. Canonicalizing both sides makes every opponent's
 * record correct too, not just CTE's own page.
 */
export async function getFranchiseRivalries(teamId: number) {
  const homeFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.home_team_id');
  const awayFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.away_team_id');

  return asPublic<FranchiseRivalry>(
    `with sides as (
       select m.season,
              ${homeFranchiseId}::int as team_id,
              ${awayFranchiseId}::int as opp_id,
              m.home_points as pf,
              m.winner = 'HOME' as won,
              m.winner = 'TIE' as tied
         from public.matchups m
        where m.is_final and m.home_points is not null and m.away_points is not null
       union all
       select m.season,
              ${awayFranchiseId}::int as team_id,
              ${homeFranchiseId}::int as opp_id,
              m.away_points as pf,
              m.winner = 'AWAY' as won,
              m.winner = 'TIE' as tied
         from public.matchups m
        where m.is_final and m.home_points is not null and m.away_points is not null
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
