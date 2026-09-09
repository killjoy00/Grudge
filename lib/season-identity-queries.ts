import 'server-only';

import { asPublic } from './db.ts';

/** Every franchise season on record, including the current season before results. */
export async function getIdentitySeasonList() {
  return asPublic<{ season: number }>(
    `select distinct season::int as season
       from public.franchise_season_teams
      order by season desc`
  );
}

/** The current/preseason field is franchise identity data, not a result row. */
export async function getIdentitySeasonField(season: number) {
  return asPublic<{
    franchise_key: string;
    espn_team_id: number | null;
    name: string;
    current_name: string;
    games: number;
  }>(
    `select fst.franchise_key, fst.espn_team_id, fst.team_name as name, f.current_name,
            (select count(*)
               from public.matchups m
              where fst.espn_team_id is not null
                and m.season = fst.season
                and fst.espn_team_id in (m.home_team_id, m.away_team_id))::int as games
       from public.franchise_season_teams fst
       join public.franchises f using(franchise_key)
      where fst.season = $1
      order by fst.team_name, fst.franchise_key`,
    [season]
  );
}

/** Exact season-scoped provider-team -> durable franchise bridge for UI links. */
export async function getSeasonFranchiseMap(season: number) {
  return asPublic<{ espn_team_id: number; franchise_key: string }>(
    `select espn_team_id, franchise_key
       from public.franchise_season_teams
      where season = $1 and espn_team_id is not null`,
    [season]
  );
}

/** Power rankings resolve provider team ids inside the season before linking. */
export async function getIdentityPowerRankings(season: number, week?: number) {
  return asPublic<{
    espn_team_id: number;
    franchise_key: string;
    name: string;
    rank: number;
    score: string;
    components: unknown;
    week: number;
  }>(
    `select p.espn_team_id, fst.franchise_key, fst.team_name as name,
            p.rank, round(p.score, 4)::text as score, p.components, p.week
       from public.power_rankings p
       join public.franchise_season_teams fst
         on fst.season = p.season and fst.espn_team_id = p.espn_team_id
      where p.season = $1
        and p.week = coalesce($2::int,
          (select max(week) from public.power_rankings where season = $1))
      order by p.rank`,
    [season, week ?? null]
  );
}
