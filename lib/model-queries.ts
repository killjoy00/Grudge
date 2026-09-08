import { trackedMatchupSql } from './playoff-policy.ts';

/** Keep ownership for excluded games; scoring comes only from its canonical key. */
export const TRADE_ROSTER_SQL = `
select r.week, r.espn_team_id, r.espn_player_id, r.lineup_slot_id, r.is_starter,
       s.points as applied_points,
       exists (select 1 from public.matchups m
         where m.season = r.season and m.week = r.week
           and r.espn_team_id in (m.home_team_id, m.away_team_id)
           and ${trackedMatchupSql('m')}) as tracked
  from public.roster_entries r
  join public.weeks w on w.season = r.season and w.week = r.week and w.results_complete
  left join public.player_week_scores s
    on s.season = r.season and s.week = r.week and s.espn_player_id = r.espn_player_id
 where r.season = $1
 order by r.week, r.espn_team_id, r.espn_player_id`;

export const TRADE_POINTS_SQL = `
select s.week, s.espn_player_id, s.points, s.evidence,
       exists (select 1 from public.roster_entries r where r.season = s.season
         and r.week = s.week and r.espn_player_id = s.espn_player_id and r.is_starter) as started
  from public.player_week_scores s
  join public.weeks w on w.season = s.season and w.week = s.week and w.results_complete
 where s.season = $1 and s.espn_player_id is not null
 order by s.week, s.espn_player_id`;

export const TRADE_PLAYERS_SQL = `
with ids as (
  select espn_player_id from public.player_week_scores where season = $1 and espn_player_id is not null
  union select espn_player_id from public.roster_entries where season = $1
  union select espn_player_id from public.trade_players where season = $1
)
select i.espn_player_id, coalesce(profile.position_id, s.position_id, p.default_position_id) as default_position_id,
       coalesce(profile.eligible_slots, p.eligible_slots) as eligible_slots
  from ids i left join public.players p using (espn_player_id)
  left join public.player_season_profiles profile on profile.season = $1 and profile.espn_player_id = i.espn_player_id
  left join lateral (select position_id from public.player_week_scores x
    where x.season = $1 and x.espn_player_id = i.espn_player_id and x.position_id is not null
    order by x.week limit 1) s on true
 order by i.espn_player_id`;

export const TRADE_GAMES_SQL = `
select distinct m.week, sides.team_id
  from public.matchups m
  join public.weeks w on w.season = m.season and w.week = m.week and w.results_complete
  cross join lateral (values (m.home_team_id), (m.away_team_id)) sides(team_id)
 where m.season = $1 and sides.team_id is not null and ${trackedMatchupSql('m')}
 order by m.week, sides.team_id`;

export const PUBLISHED_TRADE_SQL = `
select t.season, t.trade_id, r.fit, r.production, m.model_version, m.as_of_week, m.created_at
  from public.trades t
  join public.model_publications p on p.season = t.season and p.model_kind = 'trade' and p.coverage_status = 'ready'
  join public.model_runs m on m.run_id = p.run_id
  join public.trade_grade_results r on r.run_id = m.run_id and r.season = t.season
    and r.trade_id = t.trade_id and r.trade_revision = t.revision_hash
 where t.evidence_status = 'active'`;
