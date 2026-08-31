import 'server-only';

/**
 * Read queries for the site. Everything here reads the derived tables the
 * pipeline writes -- the site never recomputes a model at request time.
 */
import { asPublic, asUser } from './db.ts';

export const CURRENT_SEASON = 2026;

export interface TeamRow {
  espn_team_id: number;
  name: string;
  abbrev: string | null;
  logo_url: string | null;
  owners: string | null;
}

export async function getTeams(season: number) {
  return asPublic<TeamRow>(
    `select t.espn_team_id, t.name, t.abbrev, t.logo_url,
            string_agg(coalesce(m.first_name || ' ' || m.last_name, m.display_name), ', ') as owners
       from public.teams t
       left join public.team_owners o on o.season = t.season and o.espn_team_id = t.espn_team_id
       left join public.members m on m.season = o.season and m.swid = o.swid
      where t.season = $1
      group by t.espn_team_id, t.name, t.abbrev, t.logo_url
      order by t.espn_team_id`,
    [season]
  );
}

/** Seasons that actually have played games, newest first. */
export async function getPlayedSeasons() {
  return asPublic<{ season: number; weeks: number }>(
    `select season, max(week)::int as weeks
       from public.team_week_results group by season order by season desc`
  );
}

export async function getStandings(season: number, week?: number) {
  return asPublic<{
    espn_team_id: number; name: string; abbrev: string | null; logo_url: string | null;
    wins: number; losses: number; ties: number; points_for: string; points_against: string;
  }>(
    `with latest as (
       select espn_team_id, max(week) as week
         from public.team_week_results
        where season = $1 and ($2::int is null or week <= $2::int)
        group by espn_team_id
     )
     select t.espn_team_id, t.name, t.abbrev, t.logo_url,
            r.cum_wins as wins, r.cum_losses as losses, r.cum_ties as ties,
            round(r.cum_points_for, 1)::text as points_for,
            round(r.cum_points_against, 1)::text as points_against
       from latest l
       join public.team_week_results r
         on r.season = $1 and r.espn_team_id = l.espn_team_id and r.week = l.week
       join public.teams t on t.season = $1 and t.espn_team_id = r.espn_team_id
      order by r.cum_wins desc, r.cum_points_for desc`,
    [season, week ?? null]
  );
}

export async function getPowerRankings(season: number, week?: number) {
  return asPublic<{
    espn_team_id: number; name: string; rank: number; score: string; components: unknown; week: number;
  }>(
    `select p.espn_team_id, t.name, p.rank, round(p.score, 4)::text as score,
            p.components, p.week
       from public.power_rankings p
       join public.teams t on t.season = p.season and t.espn_team_id = p.espn_team_id
      where p.season = $1
        and p.week = coalesce($2::int, (select max(week) from public.power_rankings where season = $1))
      order by p.rank`,
    [season, week ?? null]
  );
}

export async function getPlayoffOdds(season: number) {
  return asPublic<{
    espn_team_id: number; name: string; playoff_pct: string; bye_pct: string;
    week: number; assumptions: unknown;
  }>(
    `select o.espn_team_id, t.name,
            round(o.playoff_pct * 100, 1)::text as playoff_pct,
            round(o.bye_pct * 100, 1)::text as bye_pct,
            o.week, o.assumptions
       from public.playoff_odds o
       join public.teams t on t.season = o.season and t.espn_team_id = o.espn_team_id
      where o.season = $1
        and o.week = (select max(week) from public.playoff_odds where season = $1)
      order by o.playoff_pct desc`,
    [season]
  );
}

export async function getLuck(season: number) {
  return asPublic<{
    espn_team_id: number; name: string; actual_wins: number;
    expected_wins: string; luck_delta: string;
  }>(
    `select l.espn_team_id, t.name, l.actual_wins,
            round(l.expected_wins, 2)::text as expected_wins,
            round(l.luck_delta, 2)::text as luck_delta
       from public.luck_index l
       join public.teams t on t.season = l.season and t.espn_team_id = l.espn_team_id
      where l.season = $1
        and l.week = (select max(week) from public.luck_index where season = $1)
      order by l.luck_delta desc`,
    [season]
  );
}

export async function getWeekResults(season: number, week: number) {
  return asPublic<{
    espn_matchup_id: number; week: number;
    home_team_id: number; home_name: string; home_points: string | null;
    away_team_id: number; away_name: string; away_points: string | null;
    winner: string; is_final: boolean;
  }>(
    `select m.espn_matchup_id, m.week,
            m.home_team_id, ht.name as home_name, round(m.home_points, 1)::text as home_points,
            m.away_team_id, at.name as away_name, round(m.away_points, 1)::text as away_points,
            m.winner, m.is_final
       from public.matchups m
       join public.teams ht on ht.season = m.season and ht.espn_team_id = m.home_team_id
       join public.teams at on at.season = m.season and at.espn_team_id = m.away_team_id
      where m.season = $1 and m.week = $2
      order by m.espn_matchup_id`,
    [season, week]
  );
}

export async function getWeekAwards(season: number, week: number) {
  return asPublic<{ award_key: string; espn_team_id: number | null; name: string | null; value: string; detail: unknown }>(
    `select a.award_key, a.espn_team_id, t.name, round(a.value, 1)::text as value, a.detail
       from public.weekly_awards a
       left join public.teams t on t.season = a.season and t.espn_team_id = a.espn_team_id
      where a.season = $1 and a.week = $2`,
    [season, week]
  );
}

export async function getBenchWatch(season: number, week: number) {
  return asPublic<{ name: string; points_for: string; optimal_points: string | null; points_left_on_bench: string | null }>(
    `select t.name, round(r.points_for,1)::text as points_for,
            round(r.optimal_points,1)::text as optimal_points,
            round(r.points_left_on_bench,1)::text as points_left_on_bench
       from public.team_week_results r
       join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
      where r.season = $1 and r.week = $2
      order by r.points_left_on_bench desc nulls last`,
    [season, week]
  );
}

/** All-time records across every loaded season. */
export async function getAllTime() {
  return asPublic<{
    espn_team_id: number; name: string; seasons: number; wins: number; losses: number;
    ties: number; points_for: string; best_season: number | null;
  }>(
    `with finals as (
       select season, espn_team_id, max(week) as w from public.team_week_results group by season, espn_team_id
     ),
     totals as (
       select r.espn_team_id,
              count(distinct r.season)::int as seasons,
              sum(r.cum_wins)::int as wins, sum(r.cum_losses)::int as losses,
              sum(r.cum_ties)::int as ties, sum(r.cum_points_for) as points_for
         from finals f
         join public.team_week_results r
           on r.season = f.season and r.espn_team_id = f.espn_team_id and r.week = f.w
        group by r.espn_team_id
     )
     select t.espn_team_id, t.name, x.seasons, x.wins, x.losses, x.ties,
            round(x.points_for, 1)::text as points_for, null::int as best_season
       from totals x
       join public.teams t on t.espn_team_id = x.espn_team_id and t.season = (select max(season) from public.teams)
      order by x.wins desc, x.points_for desc`
  );
}

export async function getRivalries(teamId: number) {
  return asPublic<{
    opp_id: number; name: string; games: number; wins: number; losses: number;
    ties: number; avg_points_for: string; first_season: number; last_season: number;
  }>(
    `select h.opp_id, t.name, h.games::int, h.wins::int, h.losses::int, h.ties::int,
            h.avg_points_for::text, h.first_season, h.last_season
       from public.head_to_head h
       join public.teams t on t.espn_team_id = h.opp_id
                          and t.season = (select max(season) from public.teams)
      where h.team_id = $1
      order by h.games desc, h.wins desc`,
    [teamId]
  );
}

/* ---------------------------------------------------------------- user data */

/** The week picks are currently open for, plus its lock time. */
export async function getOpenWeek(season: number) {
  const rows = await asPublic<{ week: number; locks_at: string | null; first_kickoff_at: string | null }>(
    `select week, locks_at, first_kickoff_at
       from public.weeks
      where season = $1
        and coalesce(locks_at, first_kickoff_at) > now()
      order by week limit 1`,
    [season]
  );
  return rows[0] ?? null;
}

/**
 * My picks for a week. Reads through asUser so the SELECT policy applies --
 * which is what hides other people's open-week picks.
 */
export async function getMyPicks(season: number, week: number) {
  const [rows] = await asUser<{ espn_matchup_id: number; predicted_winner_team_id: number }>((q) => [
    q(`select espn_matchup_id, predicted_winner_team_id
         from public.predictions
        where season = $1 and week = $2 and user_id = app.current_user_id()`, [season, week]),
  ]);
  return rows ?? [];
}

export async function getLeaderboard(season: number) {
  const [rows] = await asUser<{
    user_id: string; display_name: string | null; picks_made: number;
    correct: number; points: string; accuracy: string | null;
  }>((q) => [
    q(`select user_id, display_name, picks_made::int, correct::int,
              points::text, accuracy::text
         from public.prediction_leaderboard
        where season = $1
        order by points desc, correct desc`, [season]),
  ]);
  return rows ?? [];
}

export async function getComments(season: number, week: number) {
  const [rows] = await asUser<{
    id: string; user_id: string; body: string; parent_id: string | null;
    created_at: string; updated_at: string; display_name: string | null;
    is_deleted: boolean;
  }>((q) => [
    q(`select c.id, c.user_id,
              case when c.deleted_at is null then c.body else '' end as body,
              c.parent_id, c.created_at, c.updated_at, p.display_name,
              (c.deleted_at is not null) as is_deleted
         from public.comments c
         left join public.profiles p on p.id = c.user_id
        where c.season = $1 and c.week = $2
          and (
            c.deleted_at is null
            or exists (
              select 1 from public.comments reply
               where reply.parent_id = c.id and reply.deleted_at is null
            )
          )
        order by c.created_at`, [season, week]),
  ]);
  return rows ?? [];
}
