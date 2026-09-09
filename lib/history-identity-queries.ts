import 'server-only';

import { asPublic } from './db.ts';

export interface FranchiseIdentity {
  franchise_key: string;
  current_name: string;
  espn_team_id: number | null;
}

export interface FranchiseKeyPlayerRow {
  season: number;
  full_name: string;
  position_id: number | null;
  points: string;
  starts: number;
}

/** Latest explicit provider identity for display/linking; never inferred by id reuse. */
export async function getFranchiseIdentity(franchiseKey: string) {
  const rows = await asPublic<FranchiseIdentity>(
    `select f.franchise_key, f.current_name, latest.espn_team_id
       from public.franchises f
       left join lateral (
         select fst.espn_team_id
           from public.franchise_season_teams fst
          where fst.franchise_key = f.franchise_key and fst.espn_team_id is not null
          order by fst.season desc
          limit 1
       ) latest on true
      where f.franchise_key = $1`,
    [franchiseKey]
  );
  return rows[0] ?? null;
}

/**
 * Legacy /team/:id URLs do not carry a season. Resolve them only from explicit
 * season mappings, preferring the newest reviewed mapping for that provider id.
 */
export async function getFranchiseKeyForEspnId(espnTeamId: number) {
  const rows = await asPublic<{ franchise_key: string }>(
    `select franchise_key
       from public.franchise_season_teams
      where espn_team_id = $1
      order by season desc
      limit 1`,
    [espnTeamId]
  );
  return rows[0]?.franchise_key ?? null;
}

/**
 * Top starters are joined through each season's exact franchise/team mapping.
 * This preserves historical team-id handoffs (notably CTE: 7 in 2005, 10 after)
 * and uses the canonical NFL player bridge for display identity.
 */
export async function getFranchiseKeyPlayersByKey(franchiseKey: string) {
  return asPublic<FranchiseKeyPlayerRow>(
    `select season, full_name, position_id, points, starts from (
       select r.season, p.full_name, p.position_id,
              round(sum(r.applied_points), 1)::text as points,
              count(*)::int as starts,
              row_number() over (
                partition by r.season order by sum(r.applied_points) desc
              ) as rn
         from public.roster_entries r
         join public.franchise_season_teams fst
           on fst.season = r.season and fst.espn_team_id = r.espn_team_id
         join public.player_identity p
           on p.season = r.season and p.espn_player_id = r.espn_player_id
        where fst.franchise_key = $1
          and r.is_starter and r.applied_points is not null
        group by r.season, p.player_key, p.full_name, p.position_id
     ) ranked
      where rn <= 3
      order by season desc, rn`,
    [franchiseKey]
  );
}
