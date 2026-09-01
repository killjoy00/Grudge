import 'server-only';

/**
 * Read queries for the site. Everything here reads the derived tables the
 * pipeline writes -- the site never recomputes a model at request time.
 */
import { asPublic, asUser } from './db.ts';

/** Latest season actually loaded, so New Year's Day never requires a code edit. */
export async function getCurrentSeason() {
  const rows = await asPublic<{ season: number | null }>(
    'select max(season)::int as season from public.seasons'
  );
  return rows[0]?.season ?? new Date().getUTCFullYear();
}

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

/**
 * All-time records by durable franchise identity, spanning the transcribed
 * 2005-2017 seasons and the ESPN era in one table.
 */
export async function getFranchiseHistory() {
  return asPublic<{
    franchise_key: string; current_name: string; espn_team_id: number | null;
    seasons: number; regular_wins: number; regular_losses: number; regular_ties: number;
    playoff_wins: number; playoff_losses: number; championships: number;
    runner_ups: number; top_four: number; playoff_appearances: number;
    title_seasons: string | null;
    regular_points_for: string | null; regular_points_against: string | null;
    first_season: number; last_season: number;
  }>(
    `select franchise_key, current_name, espn_team_id, seasons, regular_wins,
            regular_losses, regular_ties, playoff_wins, playoff_losses,
            championships, runner_ups, top_four, playoff_appearances, title_seasons,
            round(regular_points_for, 1)::text as regular_points_for,
            round(regular_points_against, 1)::text as regular_points_against,
            first_season, last_season
       from public.franchise_history_totals
      order by championships desc, regular_wins desc, playoff_wins desc, current_name`
  );
}

/** The same record attributed to people through explicit season mappings. */
export async function getManagerHistory() {
  return asPublic<{
    manager_key: string; display_name: string; seasons: number;
    regular_wins: number; regular_losses: number; regular_ties: number;
    playoff_wins: number; playoff_losses: number; championships: number;
    runner_ups: number; top_four: number; playoff_appearances: number;
    title_seasons: string | null;
    regular_points_for: string | null; first_season: number; last_season: number;
  }>(
    `select manager_key, display_name, seasons, regular_wins, regular_losses,
            regular_ties, playoff_wins, playoff_losses, championships,
            runner_ups, top_four, playoff_appearances, title_seasons,
            round(regular_points_for, 1)::text as regular_points_for,
            first_season, last_season
       from public.manager_history_totals
      order by championships desc, regular_wins desc, playoff_wins desc, display_name`
  );
}

/**
 * A season's table, from the franchise record rather than the weekly feed, so
 * 2005-2017 and the ESPN era render through one path. Ordered by the league's
 * own seeding rule: win percentage, then total points.
 */
export async function getSeasonStandings(season: number) {
  return asPublic<{
    franchise_key: string; current_name: string; team_name: string;
    espn_team_id: number | null; wins: number; losses: number; ties: number;
    points_for: string | null; points_against: string | null;
    playoff_wins: number; playoff_losses: number; final_place: number | null;
    is_champion: boolean; is_runner_up: boolean; source: string;
  }>(
    `select fs.franchise_key, f.current_name, fs.team_name, fs.espn_team_id,
            fs.regular_wins as wins, fs.regular_losses as losses, fs.regular_ties as ties,
            round(fs.regular_points_for, 1)::text as points_for,
            round(fs.regular_points_against, 1)::text as points_against,
            fs.playoff_wins, fs.playoff_losses, fs.final_place,
            fs.is_champion, fs.is_runner_up, fs.source
       from public.franchise_seasons fs
       join public.franchises f using (franchise_key)
      where fs.season = $1
      order by (fs.regular_wins + fs.regular_ties / 2.0)
               / nullif(fs.regular_wins + fs.regular_losses + fs.regular_ties, 0) desc,
               fs.regular_points_for desc`,
    [season]
  );
}

/** Season by season for the franchise that owns an ESPN team id. */
export async function getFranchiseSeasons(espnTeamId: number) {
  return asPublic<{
    season: number; team_name: string; wins: number; losses: number; ties: number;
    points_for: string | null; points_against: string | null;
    playoff_wins: number; playoff_losses: number; final_place: number | null;
    is_champion: boolean; is_runner_up: boolean; manager: string | null;
  }>(
    `with target as (
       select franchise_key from public.franchise_seasons
        where espn_team_id = $1 limit 1
     )
     select fs.season, fs.team_name, fs.regular_wins as wins, fs.regular_losses as losses,
            fs.regular_ties as ties,
            round(fs.regular_points_for, 1)::text as points_for,
            round(fs.regular_points_against, 1)::text as points_against,
            fs.playoff_wins, fs.playoff_losses, fs.final_place,
            fs.is_champion, fs.is_runner_up,
            (select m.display_name
               from public.manager_franchise_seasons ms
               join public.managers m using (manager_key)
              where ms.season = fs.season and ms.franchise_key = fs.franchise_key
                and ms.is_primary
              limit 1) as manager
       from public.franchise_seasons fs
       join target t on t.franchise_key = fs.franchise_key
      order by fs.season desc`,
    [espnTeamId]
  );
}

/** Each manager's record while running that franchise, newest tenure first. */
export async function getFranchiseManagers(espnTeamId: number) {
  return asPublic<{
    manager_key: string; display_name: string; seasons: number;
    regular_wins: number; regular_losses: number; regular_ties: number;
    playoff_wins: number; playoff_losses: number; championships: number;
    top_four: number; playoff_appearances: number; regular_points_for: string | null;
    first_season: number; last_season: number;
  }>(
    `with target as (
       select franchise_key from public.franchise_seasons
        where espn_team_id = $1 limit 1
     )
     select t.manager_key, t.display_name, t.seasons, t.regular_wins, t.regular_losses,
            t.regular_ties, t.playoff_wins, t.playoff_losses, t.championships,
            t.top_four, t.playoff_appearances,
            round(t.regular_points_for, 1)::text as regular_points_for,
            t.first_season, t.last_season
       from public.franchise_manager_totals t
       join target g on g.franchise_key = t.franchise_key
      order by t.last_season desc, t.first_season desc`,
    [espnTeamId]
  );
}

/** One row per played season, newest first, for the title roll. */
export async function getSeasonChampions() {
  return asPublic<{
    season: number; champion_key: string | null; champion_name: string | null;
    champion_team_name: string | null; runner_up_name: string | null;
    source: string; teams: number;
  }>(
    `select season, champion_key, champion_name, champion_team_name,
            runner_up_name, source, teams
       from public.season_champions
      order by season desc`
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

/**
 * A week's matchups with the people behind each team, for the picks page.
 * Owners are first names joined with "and" -- "Ryan and Byron" -- because the
 * point of the page is which person you are betting against, not which ESPN
 * slot. Primary owner leads.
 */
export async function getWeekMatchups(season: number, week: number) {
  return asPublic<{
    espn_matchup_id: number; week: number;
    home_team_id: number; home_name: string; home_owners: string | null;
    away_team_id: number; away_name: string; away_owners: string | null;
    home_points: string | null; away_points: string | null;
    winner: string; is_final: boolean;
  }>(
    `with owners as (
       select o.season, o.espn_team_id,
              -- ESPN stores some first names lowercase ("byron"). Capitalise
              -- the first letter only; initcap() would wreck "McNeill".
              string_agg(
                (with raw as (
                   select coalesce(nullif(trim(m.first_name), ''), m.display_name) as n
                 )
                 select upper(left(n, 1)) || substr(n, 2) from raw),
                ' and ' order by o.is_primary desc, m.first_name
              ) as names
         from public.team_owners o
         join public.members m on m.season = o.season and m.swid = o.swid
        where o.season = $1
        group by o.season, o.espn_team_id
     )
     select mu.espn_matchup_id, mu.week,
            mu.home_team_id, ht.name as home_name, ho.names as home_owners,
            mu.away_team_id, at.name as away_name, ao.names as away_owners,
            round(mu.home_points, 1)::text as home_points,
            round(mu.away_points, 1)::text as away_points,
            mu.winner, mu.is_final
       from public.matchups mu
       join public.teams ht on ht.season = mu.season and ht.espn_team_id = mu.home_team_id
       join public.teams at on at.season = mu.season and at.espn_team_id = mu.away_team_id
       left join owners ho on ho.espn_team_id = mu.home_team_id
       left join owners ao on ao.espn_team_id = mu.away_team_id
      where mu.season = $1 and mu.week = $2
      order by mu.espn_matchup_id`,
    [season, week]
  );
}

/** Every player's prediction record across all seasons. */
export async function getAllTimeLeaderboard() {
  const [rows] = await asUser<{
    user_id: string; display_name: string | null; picks_made: number;
    correct: number; points: string; accuracy: string | null;
    first_season: number; last_season: number;
  }>((q) => [
    q(`select user_id, display_name, picks_made::int, correct::int,
              points::text, accuracy::text, first_season, last_season
         from public.prediction_leaderboard_alltime
        order by points desc, correct desc`),
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
