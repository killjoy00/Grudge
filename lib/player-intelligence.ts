import 'server-only';

import { asPublic } from './db.ts';
import { trackedMatchupSql } from './playoff-policy.ts';

export interface PlayerContributionRow {
  player_key: string;
  full_name: string;
  position: string;
  seasons: number;
  starts: number;
  points: string;
  latest_season: number;
}

export interface PlayerGrudgeSeasonRow {
  season: number;
  franchise_key: string;
  team_name: string;
  roster_weeks: number;
  starts: number;
  points: string | null;
}

export interface PlayerFrequencyRow {
  player_key: string;
  full_name: string;
  position: string;
  events: number;
  seasons: number;
  first_season: number;
  last_season: number;
}

const tracked = trackedMatchupSql('m');
const CREDITED = `with credited as (
  select a.player_key, r.season, r.week, fst.franchise_key, fst.team_name,
         r.is_starter, s.points
    from public.roster_entries r
    join public.nfl_player_aliases a
      on a.season = r.season and a.espn_player_id = r.espn_player_id
    join public.franchise_season_teams fst
      on fst.season = r.season and fst.espn_team_id = r.espn_team_id
    join public.weeks w
      on w.season = r.season and w.week = r.week and w.results_complete
    left join public.player_week_scores s
      on s.season = r.season and s.week = r.week and s.player_key = a.player_key
   where exists (
     select 1 from public.matchups m
      where m.season = r.season and m.week = r.week
        and r.espn_team_id in (m.home_team_id, m.away_team_id)
        and ${tracked}
   )
)`;

export async function getPlayerGrudgeSeasons(playerKey: string) {
  return asPublic<PlayerGrudgeSeasonRow>(
    `${CREDITED}
     select season, franchise_key, team_name,
            count(*)::int as roster_weeks,
            count(*) filter (where is_starter)::int as starts,
            case when count(*) filter (where is_starter) = count(points) filter (where is_starter)
                 then round(coalesce(sum(points) filter (where is_starter), 0), 2)::text end as points
       from credited
      where player_key = $1
      group by season, franchise_key, team_name
      order by season desc, team_name`,
    [playerKey]
  );
}

const CONTRIBUTION_SELECT = `
  select p.player_key, p.full_name, p.position,
         count(distinct c.season)::int as seasons,
         count(*) filter (where c.is_starter)::int as starts,
         round(sum(c.points) filter (where c.is_starter), 2)::text as points,
         max(c.season)::int as latest_season
    from credited c
    join public.nfl_players p using (player_key)`;

const CONTRIBUTION_HAVING = `
   having count(*) filter (where c.is_starter) > 0
      and count(*) filter (where c.is_starter) = count(c.points) filter (where c.is_starter)`;

export async function getFranchisePlayerLeaders(franchiseKey: string, limit = 8) {
  return asPublic<PlayerContributionRow>(
    `${CREDITED}
     ${CONTRIBUTION_SELECT}
     where c.franchise_key = $1
     group by p.player_key, p.full_name, p.position
     ${CONTRIBUTION_HAVING}
     order by sum(c.points) filter (where c.is_starter) desc, c.player_key
     limit $2`,
    [franchiseKey, limit]
  );
}

export async function getManagerPlayerLeaders(managerKey: string, limit = 8) {
  return asPublic<PlayerContributionRow>(
    `${CREDITED}
     ${CONTRIBUTION_SELECT}
     join public.manager_franchise_seasons ms
       on ms.season = c.season and ms.franchise_key = c.franchise_key and ms.is_primary
     where ms.manager_key = $1
     group by p.player_key, p.full_name, p.position
     ${CONTRIBUTION_HAVING}
     order by sum(c.points) filter (where c.is_starter) desc, c.player_key
     limit $2`,
    [managerKey, limit]
  );
}

export async function getPlayerRecordLeaders(limit = 10) {
  const [starterPoints, drafted, traded] = await Promise.all([
    asPublic<PlayerContributionRow>(
      `${CREDITED}
       ${CONTRIBUTION_SELECT}
       group by p.player_key, p.full_name, p.position
       ${CONTRIBUTION_HAVING}
       order by sum(c.points) filter (where c.is_starter) desc, c.player_key
       limit $1`,
      [limit]
    ),
    asPublic<PlayerFrequencyRow>(
      `select p.player_key, p.full_name, p.position,
              count(*)::int as events, count(distinct d.season)::int as seasons,
              min(d.season)::int as first_season, max(d.season)::int as last_season
         from public.draft_picks d
         join public.nfl_player_aliases a
           on a.season = d.season and a.espn_player_id = d.espn_player_id
         join public.nfl_players p on p.player_key = a.player_key
        group by p.player_key, p.full_name, p.position
        order by count(*) desc, max(d.season) desc, p.full_name
        limit $1`,
      [limit]
    ),
    asPublic<PlayerFrequencyRow>(
      `select p.player_key, p.full_name, p.position,
              count(*)::int as events, count(distinct tp.season)::int as seasons,
              min(tp.season)::int as first_season, max(tp.season)::int as last_season
         from public.trade_players tp
         join public.trades t
           on t.season = tp.season and t.trade_id = tp.trade_id and t.evidence_status = 'active'
         join public.nfl_players p on p.player_key = tp.player_key
        group by p.player_key, p.full_name, p.position
        order by count(*) desc, max(tp.season) desc, p.full_name
        limit $1`,
      [limit]
    ),
  ]);
  return { starterPoints, drafted, traded };
}
