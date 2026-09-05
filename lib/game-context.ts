import 'server-only';

import { asPublic } from './db.ts';
import { canonicalEspnTeamIdSql } from './franchise-identity.ts';

export interface IncompleteWeek {
  week: number;
  first_kickoff_at: string | null;
  locks_at: string | null;
  results_complete: boolean;
}

/**
 * The week the league is currently living in.
 *
 * This is deliberately the FIRST INCOMPLETE week, not the first week whose
 * pick deadline is still in the future. Once Saturday's deadline passes the
 * league is still in that week until ESPN settles it and the Tuesday pipeline
 * marks results_complete. Choosing by lock time was what made /predictions
 * jump to next week's slate as soon as the current board locked.
 */
export async function getCurrentIncompleteWeek(season: number) {
  const rows = await asPublic<IncompleteWeek>(
    `select week, first_kickoff_at, locks_at, results_complete
       from public.weeks
      where season = $1 and not results_complete
      order by week
      limit 1`,
    [season]
  );
  return rows[0] ?? null;
}

export interface MatchupTeamContext {
  espn_team_id: number;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: string;
  power_rank: number | null;
  power_score: string | null;
}

/** Standings and power-rank context as it existed BEFORE the matchup week. */
export async function getMatchupTeamContext(
  season: number,
  week: number,
  teamA: number,
  teamB: number
) {
  return asPublic<MatchupTeamContext>(
    `select t.espn_team_id, t.name,
            coalesce(r.cum_wins, 0)::int as wins,
            coalesce(r.cum_losses, 0)::int as losses,
            coalesce(r.cum_ties, 0)::int as ties,
            round(coalesce(r.cum_points_for, 0), 1)::text as points_for,
            p.rank::int as power_rank,
            case when p.score is null then null else round(p.score, 4)::text end as power_score
       from public.teams t
       left join lateral (
         select x.cum_wins, x.cum_losses, x.cum_ties, x.cum_points_for
           from public.team_week_results x
          where x.season = t.season
            and x.espn_team_id = t.espn_team_id
            and x.week < $2
          order by x.week desc
          limit 1
       ) r on true
       left join lateral (
         select x.rank, x.score
           from public.power_rankings x
          where x.season = t.season
            and x.espn_team_id = t.espn_team_id
            and x.week < $2
          order by x.week desc
          limit 1
       ) p on true
      where t.season = $1 and t.espn_team_id in ($3, $4)
      order by t.espn_team_id`,
    [season, week, teamA, teamB]
  );
}

export interface RivalryGame {
  season: number;
  week: number;
  espn_matchup_id: number;
  home_team_id: number;
  home_name: string;
  away_team_id: number;
  away_name: string;
  home_points: string | null;
  away_points: string | null;
  winner: string;
  playoff_tier: string | null;
}

export interface RivalryTeam {
  espn_team_id: number;
  name: string;
}

/**
 * Every finalized meeting between two durable franchises, newest first.
 *
 * Raw ESPN team IDs are stable across the archive except for one verified
 * handoff: the current CTE franchise was team 7 in 2005 and team 10 from 2006
 * onward. Canonicalizing here makes the rivalry URL permanent while keeping
 * the historical team names beside each old game.
 */
export async function getRivalrySeries(teamA: number, teamB: number) {
  const homeFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.home_team_id');
  const awayFranchiseId = canonicalEspnTeamIdSql('m.season', 'm.away_team_id');
  const [teams, games] = await Promise.all([
    asPublic<RivalryTeam>(
      `select t.espn_team_id, t.name
         from public.teams t
        where t.season = (select max(season) from public.teams)
          and t.espn_team_id in ($1, $2)
        order by t.espn_team_id`,
      [teamA, teamB]
    ),
    asPublic<RivalryGame>(
      `select m.season, m.week, m.espn_matchup_id,
              ${homeFranchiseId}::int as home_team_id, ht.name as home_name,
              ${awayFranchiseId}::int as away_team_id, at.name as away_name,
              round(m.home_points, 2)::text as home_points,
              round(m.away_points, 2)::text as away_points,
              m.winner,
              nullif(m.playoff_tier, 'NONE') as playoff_tier
         from public.matchups m
         join public.teams ht
           on ht.season = m.season and ht.espn_team_id = m.home_team_id
         join public.teams at
           on at.season = m.season and at.espn_team_id = m.away_team_id
        where m.is_final
          and ((${homeFranchiseId} = $1 and ${awayFranchiseId} = $2)
            or (${homeFranchiseId} = $2 and ${awayFranchiseId} = $1))
        order by m.season desc, m.week desc, m.espn_matchup_id desc`,
      [teamA, teamB]
    ),
  ]);
  return { teams, games };
}

/**
 * Raw ESPN-era team-ID totals, INCLUDING playoffs.
 *
 * The history page has always described this bottom table as the raw ESPN feed
 * with playoff games included, but its old query read team_week_results -- a
 * derived table that intentionally stops at the regular season. Read matchups
 * directly here so the numbers finally match the label without contaminating
 * standings, luck, all-play, or power rankings.
 */
export async function getEspnEraAllTime() {
  return asPublic<{
    espn_team_id: number; name: string; seasons: number; wins: number; losses: number;
    ties: number; points_for: string; best_season: number | null;
  }>(
    `with sides as (
       select m.season, m.home_team_id as espn_team_id,
              m.home_points as points_for,
              case m.winner when 'HOME' then 1 else 0 end as wins,
              case m.winner when 'AWAY' then 1 else 0 end as losses,
              case m.winner when 'TIE' then 1 else 0 end as ties
         from public.matchups m
        where m.is_final and m.home_team_id is not null and m.home_points is not null
       union all
       select m.season, m.away_team_id,
              m.away_points,
              case m.winner when 'AWAY' then 1 else 0 end,
              case m.winner when 'HOME' then 1 else 0 end,
              case m.winner when 'TIE' then 1 else 0 end
         from public.matchups m
        where m.is_final and m.away_team_id is not null and m.away_points is not null
     ), totals as (
       select espn_team_id,
              count(distinct season)::int as seasons,
              sum(wins)::int as wins,
              sum(losses)::int as losses,
              sum(ties)::int as ties,
              sum(points_for) as points_for
         from sides
        group by espn_team_id
     )
     select t.espn_team_id, t.name, x.seasons, x.wins, x.losses, x.ties,
            round(x.points_for, 1)::text as points_for,
            null::int as best_season
       from totals x
       join public.teams t
         on t.espn_team_id = x.espn_team_id
        and t.season = (select max(season) from public.teams)
      order by x.wins desc, x.points_for desc`
  );
}
