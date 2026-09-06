import 'server-only';

import { asPublic } from './db.ts';
import { TITLE_PLAYOFF_TIER, trackedMatchupSql } from './playoff-policy.ts';
import type { MatchupRecordRow, PlayerWeekRecordRow } from './history-queries.ts';

export async function getTrackedPlayoffWeek(season: number) {
  const rows = await asPublic<{ week: number | null }>(
    `select max(m.week)::int as week
       from public.matchups m
      where m.season = $1 and m.is_final
        and m.playoff_tier = $2`,
    [season, TITLE_PLAYOFF_TIER]
  );
  const week = rows[0]?.week;
  if (typeof week !== 'number' || week < 1) return null;

  const games = await asPublic<{
    espn_matchup_id: number; playoff_tier: string | null;
    home_team_id: number; home_name: string; home_points: string | null;
    away_team_id: number; away_name: string; away_points: string | null;
    winner: string; is_final: boolean;
  }>(
    `select m.espn_matchup_id, m.playoff_tier,
            m.home_team_id, ht.name as home_name, round(m.home_points, 1)::text as home_points,
            m.away_team_id, at.name as away_name, round(m.away_points, 1)::text as away_points,
            m.winner, m.is_final
       from public.matchups m
       join public.teams ht on ht.season = m.season and ht.espn_team_id = m.home_team_id
       join public.teams at on at.season = m.season and at.espn_team_id = m.away_team_id
      where m.season = $1 and m.week = $2 and m.playoff_tier = $3
      order by m.espn_matchup_id`,
    [season, week, TITLE_PLAYOFF_TIER]
  );
  return { week, games };
}

export async function getTrackedTopScoringWeeks(limit = 10) {
  const tracked = trackedMatchupSql('m');
  return asPublic<{
    season: number; week: number; espn_team_id: number; name: string;
    points: string; opponent: string | null; points_against: string;
    result: string | null; playoff_tier: string | null;
  }>(
    `with sides as (
       select m.season, m.week, m.playoff_tier,
              m.home_team_id as espn_team_id, m.home_points as points_for,
              m.away_team_id as opponent_team_id, m.away_points as points_against,
              case m.winner when 'HOME' then 'W' when 'AWAY' then 'L'
                            when 'TIE' then 'T' end as result
         from public.matchups m
        where m.is_final and m.home_points is not null and ${tracked}
       union all
       select m.season, m.week, m.playoff_tier,
              m.away_team_id, m.away_points,
              m.home_team_id, m.home_points,
              case m.winner when 'AWAY' then 'W' when 'HOME' then 'L'
                            when 'TIE' then 'T' end
         from public.matchups m
        where m.is_final and m.away_points is not null and ${tracked}
     )
     select s.season, s.week, s.espn_team_id, t.name,
            round(s.points_for, 1)::text as points,
            ot.name as opponent,
            round(s.points_against, 1)::text as points_against,
            s.result,
            nullif(s.playoff_tier, 'NONE') as playoff_tier
       from sides s
       join public.teams t on t.season = s.season and t.espn_team_id = s.espn_team_id
       left join public.teams ot
         on ot.season = s.season and ot.espn_team_id = s.opponent_team_id
      order by s.points_for desc
      limit $1`,
    [limit]
  );
}

export async function getTrackedTopPlayerWeeks(limit = 10) {
  const tracked = trackedMatchupSql('m');
  return asPublic<{
    season: number; week: number; espn_player_id: number;
    full_name: string | null; default_position_id: number | null;
    points: string; espn_team_id: number; team: string; is_starter: boolean;
    playoff_tier: string | null;
  }>(
    `select r.season, r.week, r.espn_player_id,
            p.full_name, p.default_position_id,
            round(r.applied_points, 1)::text as points,
            r.espn_team_id, t.name as team, r.is_starter,
            nullif(m.playoff_tier, 'NONE') as playoff_tier
       from public.roster_entries r
       join public.players p using (espn_player_id)
       join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
       join public.weeks w
         on w.season = r.season and w.week = r.week and w.results_complete
       join public.matchups m
         on m.season = r.season and m.week = r.week
        and r.espn_team_id in (m.home_team_id, m.away_team_id)
        and ${tracked}
      where r.applied_points is not null
      order by r.applied_points desc
      limit $1`,
    [limit]
  );
}

async function getTrackedMatchupRecord(
  season: number | null,
  kind: 'highest_score' | 'lowest_score' | 'highest_scoring_loss' | 'biggest_blowout' | 'closest_finish'
) {
  const tracked = trackedMatchupSql('m');
  const filter = kind === 'highest_scoring_loss'
    ? `and x.result = 'L'`
    : kind === 'biggest_blowout'
      ? `and x.result = 'W'`
      : '';
  const order = kind === 'highest_score' || kind === 'highest_scoring_loss'
    ? 'x.points_for desc'
    : kind === 'lowest_score'
      ? 'x.points_for asc'
      : kind === 'biggest_blowout'
        ? 'abs(x.points_for - x.points_against) desc'
        : 'abs(x.points_for - x.points_against) asc, x.points_for desc';

  const rows = await asPublic<MatchupRecordRow>(
    `with sides as (
       select m.season, m.week, m.playoff_tier,
              m.home_team_id as espn_team_id, m.away_team_id as opponent_team_id,
              m.home_points as points_for, m.away_points as points_against,
              case m.winner when 'HOME' then 'W' when 'AWAY' then 'L' else 'T' end as result
         from public.matchups m
        where m.is_final and m.home_points is not null and m.away_points is not null and ${tracked}
       union all
       select m.season, m.week, m.playoff_tier,
              m.away_team_id, m.home_team_id,
              m.away_points, m.home_points,
              case m.winner when 'AWAY' then 'W' when 'HOME' then 'L' else 'T' end
         from public.matchups m
        where m.is_final and m.home_points is not null and m.away_points is not null and ${tracked}
     )
     select x.season, x.week, x.espn_team_id, fs.franchise_key,
            fs.team_name, ofs.team_name as opponent_name,
            round(x.points_for, 1)::text as points_for,
            round(x.points_against, 1)::text as points_against,
            x.result,
            round(x.points_for - x.points_against, 1)::text as margin,
            nullif(x.playoff_tier, 'NONE') as playoff_tier
       from sides x
       join public.franchise_seasons fs
         on fs.season = x.season and fs.espn_team_id = x.espn_team_id
       join public.franchise_seasons ofs
         on ofs.season = x.season and ofs.espn_team_id = x.opponent_team_id
      where ($1::int is null or x.season = $1) ${filter}
      order by ${order}
      limit 1`,
    [season]
  );
  return rows[0] ?? null;
}

export async function getTrackedTopPlayerWeekForSeason(season: number) {
  const tracked = trackedMatchupSql('m');
  const rows = await asPublic<PlayerWeekRecordRow>(
    `select r.season, r.week, r.espn_player_id, p.full_name, p.default_position_id,
            round(r.applied_points, 1)::text as points,
            fs.franchise_key, fs.team_name, r.is_starter,
            nullif(m.playoff_tier, 'NONE') as playoff_tier
       from public.roster_entries r
       join public.players p using (espn_player_id)
       join public.franchise_seasons fs
         on fs.season = r.season and fs.espn_team_id = r.espn_team_id
       join public.weeks w
         on w.season = r.season and w.week = r.week and w.results_complete
       join public.matchups m
         on m.season = r.season and m.week = r.week
        and r.espn_team_id in (m.home_team_id, m.away_team_id)
        and ${tracked}
      where r.season = $1 and r.applied_points is not null
      order by r.applied_points desc
      limit 1`,
    [season]
  );
  return rows[0] ?? null;
}

export async function getTrackedSeasonHighlights(season: number) {
  const [highestScore, biggestBlowout, closestFinish, topPlayer] = await Promise.all([
    getTrackedMatchupRecord(season, 'highest_score'),
    getTrackedMatchupRecord(season, 'biggest_blowout'),
    getTrackedMatchupRecord(season, 'closest_finish'),
    getTrackedTopPlayerWeekForSeason(season),
  ]);
  return { highestScore, biggestBlowout, closestFinish, topPlayer };
}

export async function getTrackedGameRecords() {
  const [highestScore, lowestScore, highestScoringLoss, biggestBlowout, closestFinish] = await Promise.all([
    getTrackedMatchupRecord(null, 'highest_score'),
    getTrackedMatchupRecord(null, 'lowest_score'),
    getTrackedMatchupRecord(null, 'highest_scoring_loss'),
    getTrackedMatchupRecord(null, 'biggest_blowout'),
    getTrackedMatchupRecord(null, 'closest_finish'),
  ]);
  return { highestScore, lowestScore, highestScoringLoss, biggestBlowout, closestFinish };
}
