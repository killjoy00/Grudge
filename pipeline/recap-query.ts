/**
 * Everything the weekly recap email needs, read from the database.
 *
 * Split out of send-recap.ts, which is about DELIVERY -- retries, idempotency
 * keys, per-recipient state. This file is about what goes in the letter. They
 * grew together and stopped fitting in one head at about ten queries.
 *
 * Every section here is derived, never invented. Where a section has nothing to
 * say -- no projections that week, a pick nobody disputed -- it returns null and
 * the renderer drops it rather than printing a heading over an empty table.
 */

import type {
  RecapAward, RecapBenchRow, RecapGame, RecapPredictionRow, RecapStanding,
  RecapAllPlayRow, RecapDisputedPick, RecapGrudge, RecapHistoryNote, RecapLuckRow,
  RecapMatchupDetail, RecapNextGame, RecapPowerRow, RecapRecordWatch, RecapStreak,
  WeeklyRecap,
} from './recap.ts';

export type Query = <T>(text: string, params?: unknown[]) => Promise<T[]>;

/**
 * ESPN's position ids. Written out here rather than in a lookup table because
 * these six are the whole universe for a fantasy football roster and have not
 * changed in the eight seasons of archive.
 */
const POSITION_CASE = `case p.default_position_id
        when 1 then 'QB' when 2 then 'RB' when 3 then 'WR'
        when 4 then 'TE' when 5 then 'K'  when 16 then 'D/ST' else 'other' end`;

/** How many top-10 all-time weeks a score has to beat to be worth calling out. */
const RECORD_WATCH_DEPTH = 10;

async function latestPlayedWeek(query: Query, season: number): Promise<number | null> {
  const rows = await query<{ week: number | null }>(
    `select max(week)::int as week from public.team_week_results
      where season = $1 and points_for is not null`,
    [season]
  );
  const week = Number(rows[0]?.week);
  return Number.isInteger(week) && week > 0 ? week : null;
}

/* ------------------------------------------------------------ per matchup */

/**
 * The three things worth saying about a single game.
 *
 * Run as three queries rather than one wide join: each has a different natural
 * grain (a player, a team, a position group) and forcing them together produced
 * a query nobody could read and Postgres could not plan well.
 */
async function matchupDetail(
  query: Query, season: number, week: number
): Promise<Map<number, RecapMatchupDetail>> {
  const [surprises, decisions, gaps] = await Promise.all([
    // Biggest surprise: the starter who most beat their own projection. Within
    // this week only -- a 30 from a player projected for 3 is the story,
    // regardless of what they have done all season.
    query<{
      espn_matchup_id: number; team: string; player: string;
      projected: string; actual: string; delta: string;
    }>(
      `with s as (
         select r.espn_team_id, pl.full_name,
                r.applied_points, r.projected_points,
                r.applied_points - r.projected_points as delta
           from public.roster_entries r
           join public.players pl using (espn_player_id)
          where r.season = $1 and r.week = $2 and r.is_starter
            and r.projected_points is not null and r.applied_points is not null
       ), m as (
         select espn_matchup_id, home_team_id, away_team_id
           from public.matchups
          where season = $1 and week = $2 and is_final
       )
       select distinct on (m.espn_matchup_id)
              m.espn_matchup_id, t.name as team, s.full_name as player,
              round(s.projected_points, 1)::text as projected,
              round(s.applied_points, 1)::text as actual,
              round(s.delta, 1)::text as delta
         from m
         join s on s.espn_team_id in (m.home_team_id, m.away_team_id)
         join public.teams t on t.season = $1 and t.espn_team_id = s.espn_team_id
        order by m.espn_matchup_id, s.delta desc`,
      [season, week]
    ),

    // Worst decision: the costlier of the two teams' start/sit mistakes.
    //
    // Both joins to players are INNER on purpose. The pipeline stores a worst
    // call only when a legal swap existed -- the benched player eligible for
    // the slot the displaced starter actually held -- so a manager who set
    // their lineup right produces no row here and the line is simply omitted.
    query<{
      espn_matchup_id: number; team: string; player: string;
      bench_points: string; displaced: string; displaced_points: string; cost: string;
    }>(
      `with m as (
         select espn_matchup_id, home_team_id, away_team_id
           from public.matchups
          where season = $1 and week = $2 and is_final
       )
       select distinct on (m.espn_matchup_id)
              m.espn_matchup_id, t.name as team, pl.full_name as player,
              round(r.worst_bench_points, 1)::text as bench_points,
              dp.full_name as displaced,
              round(r.worst_bench_started_points, 1)::text as displaced_points,
              round(r.worst_bench_points - r.worst_bench_started_points, 1)::text as cost
         from m
         join public.team_week_results r
           on r.season = $1 and r.week = $2
          and r.espn_team_id in (m.home_team_id, m.away_team_id)
         join public.players pl on pl.espn_player_id = r.worst_bench_player_id
         join public.players dp on dp.espn_player_id = r.worst_bench_displaced_player_id
         join public.teams t on t.season = $1 and t.espn_team_id = r.espn_team_id
        order by m.espn_matchup_id,
                 r.worst_bench_points - r.worst_bench_started_points desc`,
      [season, week]
    ),

    // Biggest differentiator: the position group where the game was actually
    // decided. Cross join so a position one side started nobody at still
    // counts as a gap -- a zero at TE against 20 is the story, not a missing row.
    query<{
      espn_matchup_id: number; position: string;
      home_points: string; away_points: string; gap: string;
    }>(
      `with slots(id, label) as (
         values (1,'QB'), (2,'RB'), (3,'WR'), (4,'TE'), (5,'K'), (16,'D/ST')
       ), pos as (
         select r.espn_team_id, pl.default_position_id as pid,
                sum(r.applied_points) as pts
           from public.roster_entries r
           join public.players pl using (espn_player_id)
          where r.season = $1 and r.week = $2 and r.is_starter
            and r.applied_points is not null
          group by 1, 2
       ), m as (
         select espn_matchup_id, home_team_id, away_team_id
           from public.matchups
          where season = $1 and week = $2 and is_final
       )
       select distinct on (m.espn_matchup_id)
              m.espn_matchup_id, s.label as position,
              round(coalesce(h.pts, 0), 1)::text as home_points,
              round(coalesce(a.pts, 0), 1)::text as away_points,
              round(abs(coalesce(h.pts, 0) - coalesce(a.pts, 0)), 1)::text as gap
         from m
         cross join slots s
         left join pos h on h.espn_team_id = m.home_team_id and h.pid = s.id
         left join pos a on a.espn_team_id = m.away_team_id and a.pid = s.id
        order by m.espn_matchup_id,
                 abs(coalesce(h.pts, 0) - coalesce(a.pts, 0)) desc`,
      [season, week]
    ),
  ]);

  const out = new Map<number, RecapMatchupDetail>();
  const detail = (id: number) => {
    const found = out.get(id) ?? { surprise: null, worstDecision: null, differentiator: null };
    out.set(id, found);
    return found;
  };
  for (const r of surprises) {
    detail(r.espn_matchup_id).surprise = {
      team: r.team, player: r.player,
      projected: r.projected, actual: r.actual, delta: r.delta,
    };
  }
  for (const r of decisions) {
    detail(r.espn_matchup_id).worstDecision = {
      team: r.team, player: r.player, benchPoints: r.bench_points,
      displaced: r.displaced, displacedPoints: r.displaced_points, cost: r.cost,
    };
  }
  for (const r of gaps) {
    detail(r.espn_matchup_id).differentiator = {
      position: r.position, homePoints: r.home_points,
      awayPoints: r.away_points, gap: r.gap,
    };
  }
  return out;
}

/* ------------------------------------------------- conditional sections */

/**
 * Did anyone put up a score that belongs in the all-time top ten?
 *
 * Ranked against every ESPN-era week, this one included, so "no. 3 all time"
 * means what it says. Returns nothing at all in a normal week, which is the
 * point: a record watch that fires every Tuesday is not a record watch.
 */
async function recordWatch(
  query: Query, season: number, week: number
): Promise<RecapRecordWatch[]> {
  return query<RecapRecordWatch>(
    `with ranked as (
       select r.season, r.week, r.espn_team_id, r.points_for,
              rank() over (order by r.points_for desc) as all_time_rank
         from public.team_week_results r
        where r.points_for is not null
     )
     select t.name, round(k.points_for, 1)::text as points,
            k.all_time_rank::int as all_time_rank
       from ranked k
       join public.teams t on t.season = k.season and t.espn_team_id = k.espn_team_id
      where k.season = $1 and k.week = $2 and k.all_time_rank <= $3
      order by k.all_time_rank`,
    [season, week, RECORD_WATCH_DEPTH]
  );
}

/**
 * The pick the league split hardest on.
 *
 * Only worth printing when both sides had real support, so a game needs at
 * least two backers EACH -- one contrarian is not a controversy. Ordered by the
 * narrowest split, then by turnout, so the most evenly divided game wins.
 */
async function disputedPick(
  query: Query, season: number, week: number
): Promise<RecapDisputedPick | null> {
  const rows = await query<RecapDisputedPick>(
    `with picks as (
       select p.espn_matchup_id, p.predicted_winner_team_id, count(*)::int as votes
         from public.predictions p
        where p.season = $1 and p.week = $2
        group by 1, 2
     ), split as (
       select m.espn_matchup_id,
              ht.name as home_name, at.name as away_name,
              coalesce(hp.votes, 0) as home_votes,
              coalesce(ap.votes, 0) as away_votes,
              m.winner
         from public.matchups m
         join public.teams ht on ht.season = $1 and ht.espn_team_id = m.home_team_id
         join public.teams at on at.season = $1 and at.espn_team_id = m.away_team_id
         left join picks hp on hp.espn_matchup_id = m.espn_matchup_id
                           and hp.predicted_winner_team_id = m.home_team_id
         left join picks ap on ap.espn_matchup_id = m.espn_matchup_id
                           and ap.predicted_winner_team_id = m.away_team_id
        where m.season = $1 and m.week = $2 and m.is_final
     )
     select home_name, away_name, home_votes, away_votes, winner
       from split
      where home_votes >= 2 and away_votes >= 2
      order by abs(home_votes - away_votes), (home_votes + away_votes) desc
      limit 1`,
    [season, week]
  );
  return rows[0] ?? null;
}

/* -------------------------------------------------------- season colour */

/**
 * Wins banked against wins the team's scoring actually earned it, this season.
 *
 * luck_delta is ALREADY cumulative -- the pipeline writes a running
 * actual-wins-minus-expected-wins at every week, so the week-14 row is the
 * whole season's luck. Summing the column across weeks added fourteen
 * running totals together and reported P RIVERS NAS NAS at +20.2 wins of luck
 * in a 14-game season, which is not a number that can exist. Read the row at
 * the requested week and nothing else.
 */
function luckReport(query: Query, season: number, week: number) {
  return query<RecapLuckRow>(
    `select t.name, round(l.luck_delta, 1)::text as luck,
            r.cum_wins::int as wins, r.cum_losses::int as losses
       from public.luck_index l
       join public.team_week_results r
         on r.season = l.season and r.week = l.week and r.espn_team_id = l.espn_team_id
       join public.teams t on t.season = l.season and t.espn_team_id = l.espn_team_id
      where l.season = $1 and l.week = $2
      order by l.luck_delta desc`,
    [season, week]
  );
}

/** What the record would be if everyone played everyone, every week. */
function allPlay(query: Query, season: number, week: number) {
  return query<RecapAllPlayRow>(
    `select t.name,
            sum(r.all_play_wins)::int as all_play_wins,
            sum(r.all_play_losses)::int as all_play_losses,
            max(r.cum_wins)::int as wins, max(r.cum_losses)::int as losses,
            round(sum(r.all_play_wins)::numeric
                  / nullif(sum(r.all_play_wins + r.all_play_losses), 0), 4)::text as pct
       from public.team_week_results r
       join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
      where r.season = $1 and r.week <= $2 and r.all_play_wins is not null
      group by t.name
      order by 6 desc`,
    [season, week]
  );
}

/**
 * Active winning and losing runs, three games or longer.
 *
 * The streak is the count of weeks back to the first result that differs from
 * the latest one; when nothing differs, the team has done the same thing all
 * season and the streak is every week they have played.
 *
 * Two in a row is not a streak, it is a fortnight, so the floor is three and
 * a week where nobody is on one returns nothing at all.
 */
function streaks(query: Query, season: number, week: number) {
  return query<RecapStreak>(
    `with r as (
       select espn_team_id, week, result,
              row_number() over (partition by espn_team_id order by week desc) as rn
         from public.team_week_results
        where season = $1 and week <= $2 and result is not null
     ), current as (
       select espn_team_id, result from r where rn = 1
     ), played as (
       select espn_team_id, max(rn) as weeks from r group by 1
     ), broke as (
       select r.espn_team_id,
              min(r.rn) filter (where r.result <> c.result) as first_change
         from r join current c using (espn_team_id)
        group by 1
     )
     select name, result, length from (
       select t.name, c.result,
              coalesce(b.first_change - 1, p.weeks)::int as length
         from current c
         join broke b using (espn_team_id)
         join played p using (espn_team_id)
         join public.teams t on t.season = $1 and t.espn_team_id = c.espn_team_id
     ) s
      where length >= 3
      order by length desc, result
      limit 4`,
    [season, week]
  );
}

/**
 * THE GRUDGE: the game played THIS WEEK with the most history behind it, and
 * where the result leaves the series.
 *
 * Anchored to a game that was actually played rather than the league's
 * all-time-longest pairing, which never changes and so stopped being news
 * after the first email. head_to_head already counts this week's result, so
 * the record shown is the one the game just produced.
 *
 * ESPN era only. The 2005-2017 archive records season finishes, not who played
 * whom, so no head-to-head exists before 2018 and claiming one would be an
 * invention. Ties broken toward the closest series -- 10-9 is a better grudge
 * than a one-sided one.
 */
async function theGrudge(
  query: Query, season: number, week: number
): Promise<RecapGrudge | null> {
  const rows = await query<RecapGrudge>(
    `with m as (
       select home_team_id, away_team_id, winner
         from public.matchups
        where season = $1 and week = $2 and is_final
     )
     select ht.name as home, at.name as away, m.winner,
            h.games::int as games, h.wins::int as wins,
            h.losses::int as losses, h.ties::int as ties,
            h.first_season::int as first_season
       from m
       join public.head_to_head h
         on h.team_id = m.home_team_id and h.opp_id = m.away_team_id
       join public.teams ht on ht.season = $1 and ht.espn_team_id = m.home_team_id
       join public.teams at on at.season = $1 and at.espn_team_id = m.away_team_id
      order by h.games desc, abs(h.wins - h.losses) asc
      limit 1`,
    [season, week]
  );
  return rows[0] ?? null;
}

/**
 * One memory from the same week number in earlier seasons -- the single most
 * remarkable thing that ever happened in a week N, not a list.
 *
 * Three candidates are gathered and exactly one is chosen, by a cascade with
 * real thresholds rather than a fixed favourite:
 *
 *   1. A finish under a point. Rarer than any big number and the only one of
 *      the three that is genuinely hard to do.
 *   2. Otherwise a score that still sits in the all-time top ten.
 *   3. Otherwise the biggest hiding anyone ever handed out.
 *
 * A week whose history holds none of those returns nothing, and the section
 * is dropped rather than padded with the merely above-average.
 */
async function thisWeekInHistory(
  query: Query, season: number, week: number
): Promise<RecapHistoryNote[]> {
  const [biggest, closest, blowout, topTen] = await Promise.all([
    query<{ season: number; name: string; points: string; opponent: string | null; against: string }>(
      `select r.season, t.name, round(r.points_for, 1)::text as points,
              ot.name as opponent, round(r.points_against, 1)::text as against
         from public.team_week_results r
         join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
         left join public.teams ot
           on ot.season = r.season and ot.espn_team_id = r.opponent_team_id
        where r.week = $1 and r.season < $2 and r.points_for is not null
        order by r.points_for desc
        limit 1`,
      [week, season]
    ),
    // Two decimals on both sides, unlike everywhere else in the email: the
    // whole claim is that the game was close, and 100.2-100.0 rounded to one
    // looks like a 0.2 margin next to a stated 0.14.
    query<{ season: number; name: string; points: string; opponent: string | null; against: string; margin: string }>(
      `select r.season, t.name, round(r.points_for, 2)::text as points,
              ot.name as opponent, round(r.points_against, 2)::text as against,
              round(r.points_for - r.points_against, 2)::text as margin
         from public.team_week_results r
         join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
         left join public.teams ot
           on ot.season = r.season and ot.espn_team_id = r.opponent_team_id
        where r.week = $1 and r.season < $2 and r.result = 'W'
          and r.points_for is not null and r.points_against is not null
        order by r.points_for - r.points_against asc
        limit 1`,
      [week, season]
    ),
    query<{ season: number; name: string; points: string; opponent: string | null; against: string; margin: string }>(
      `select r.season, t.name, round(r.points_for, 1)::text as points,
              ot.name as opponent, round(r.points_against, 1)::text as against,
              round(r.points_for - r.points_against, 1)::text as margin
         from public.team_week_results r
         join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
         left join public.teams ot
           on ot.season = r.season and ot.espn_team_id = r.opponent_team_id
        where r.week = $1 and r.season < $2 and r.result = 'W'
          and r.points_for is not null and r.points_against is not null
        order by r.points_for - r.points_against desc
        limit 1`,
      [week, season]
    ),
    // The all-time top-ten cutoff, so "still one of the biggest ever" is a
    // fact about the league rather than a guess at a round number.
    query<{ cutoff: string | null }>(
      `select min(points_for)::text as cutoff from (
         select points_for from public.team_week_results
          where points_for is not null
          order by points_for desc limit $1
       ) t`,
      [RECORD_WATCH_DEPTH]
    ),
  ]);

  const tight = closest[0];
  if (tight && Number(tight.margin) < 1) {
    return [{
      label: 'Closest ever',
      season: tight.season,
      detail: `${tight.name} edged ${tight.opponent ?? 'the field'} ` +
        `${tight.points}-${tight.against} — by ${tight.margin}`,
    }];
  }

  const top = biggest[0];
  const cutoff = Number(topTen[0]?.cutoff);
  if (top && Number.isFinite(cutoff) && Number(top.points) >= cutoff) {
    return [{
      label: 'Biggest ever',
      season: top.season,
      detail: `${top.name} put ${top.points} on ${top.opponent ?? 'the field'} ` +
        `(${top.against}) — still one of the ten best weeks in league history`,
    }];
  }

  const rout = blowout[0];
  if (rout) {
    return [{
      label: 'Biggest hiding',
      season: rout.season,
      detail: `${rout.name} beat ${rout.opponent ?? 'the field'} ` +
        `${rout.points}-${rout.against} — by ${rout.margin}`,
    }];
  }
  return [];
}

/* ------------------------------------------------------ looking forward */

/**
 * Power rankings for the week, with the move since the week before. A team
 * ranked for the first time has no movement rather than a fake zero.
 *
 * The stored score is a 0-1 composite; shown x100 because at one decimal in
 * its native scale half the league rounds to the same "0.7" and the ranking
 * looks arbitrary. Scaling is presentation only -- the model is untouched.
 */
function powerRankings(query: Query, season: number, week: number) {
  return query<RecapPowerRow>(
    `select t.name, p.rank, round(p.score * 100, 1)::text as score,
            (prev.rank - p.rank)::int as movement,
            round(o.playoff_pct * 100, 0)::text as playoff_pct
       from public.power_rankings p
       join public.teams t on t.season = p.season and t.espn_team_id = p.espn_team_id
       left join public.power_rankings prev
         on prev.season = p.season and prev.week = p.week - 1
        and prev.espn_team_id = p.espn_team_id
       left join public.playoff_odds o
         on o.season = p.season and o.week = p.week
        and o.espn_team_id = p.espn_team_id
      where p.season = $1 and p.week = $2
      order by p.rank`,
    [season, week]
  );
}

/**
 * Next week's games, with the favourite by power-ranking score.
 *
 * This is a lean, not a projection: the gap in ranking score, labelled as such,
 * so nobody mistakes it for a simulated line. The point is to give the
 * predictions page something to argue with.
 */
function nextWeek(query: Query, season: number, week: number) {
  return query<RecapNextGame>(
    `select at.name as away_name, ht.name as home_name,
            round(ap.score, 1)::text as away_score,
            round(hp.score, 1)::text as home_score
       from public.matchups m
       join public.teams at on at.season = m.season and at.espn_team_id = m.away_team_id
       join public.teams ht on ht.season = m.season and ht.espn_team_id = m.home_team_id
       left join public.power_rankings ap
         on ap.season = $1 and ap.week = $2 and ap.espn_team_id = m.away_team_id
       left join public.power_rankings hp
         on hp.season = $1 and hp.week = $2 and hp.espn_team_id = m.home_team_id
      where m.season = $1 and m.week = $2 + 1 and not m.is_final
      order by m.espn_matchup_id`,
    [season, week]
  );
}

/* ------------------------------------------------------------- assembly */

export interface LoadOptions {
  season: number;
  /** Defaults to the latest week with results. */
  week?: number | null;
}

/**
 * Assemble the whole letter, or null when the season has not produced a week
 * worth recapping yet.
 */
export async function loadRecap(
  query: Query, { season, week: requested }: LoadOptions
): Promise<WeeklyRecap | null> {
  const week = requested ?? (await latestPlayedWeek(query, season));
  if (week === null) return null;

  const [
    games, awards, bench, standings, predictions, detail,
    power, next, luck, all_play, streak, grudge, history, watch, disputed,
  ] = await Promise.all([
    query<RecapGame>(
      `select m.espn_matchup_id,
              at.name as away_name, round(m.away_points, 1)::text as away_points,
              ht.name as home_name, round(m.home_points, 1)::text as home_points,
              m.winner
         from public.matchups m
         join public.teams at on at.season = m.season and at.espn_team_id = m.away_team_id
         join public.teams ht on ht.season = m.season and ht.espn_team_id = m.home_team_id
        where m.season = $1 and m.week = $2 and m.is_final
        order by m.espn_matchup_id`, [season, week]),
    query<RecapAward>(
      `select a.award_key, t.name, round(a.value, 1)::text as value
         from public.weekly_awards a
         left join public.teams t on t.season = a.season and t.espn_team_id = a.espn_team_id
        where a.season = $1 and a.week = $2
        order by array_position(array['high_scorer','low_scorer','blowout','nailbiter','worst_bench'], a.award_key)`,
      [season, week]),
    query<RecapBenchRow>(
      `select t.name, round(r.points_for, 1)::text as points_for,
              round(r.optimal_points, 1)::text as optimal_points,
              round(r.points_left_on_bench, 1)::text as points_left_on_bench
         from public.team_week_results r
         join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
        where r.season = $1 and r.week = $2
        order by r.points_left_on_bench desc nulls last`, [season, week]),
    query<RecapStanding>(
      `select t.name, r.cum_wins as wins, r.cum_losses as losses, r.cum_ties as ties,
              round(r.cum_points_for, 1)::text as points_for
         from public.team_week_results r
         join public.teams t on t.season = r.season and t.espn_team_id = r.espn_team_id
        where r.season = $1 and r.week = $2
        order by r.cum_wins desc, r.cum_points_for desc`, [season, week]),
    query<RecapPredictionRow>(
      `select pr.display_name,
              count(*) filter (where s.is_correct)::int as correct,
              coalesce(sum(s.points), 0)::text as points,
              round(count(*) filter (where s.is_correct)::numeric
                    / nullif(count(s.prediction_id), 0), 4)::text as accuracy
         from public.predictions p
         join public.profiles pr on pr.id = p.user_id
         left join public.prediction_scores s on s.prediction_id = p.id
        where p.season = $1
        group by p.user_id, pr.display_name
        order by coalesce(sum(s.points), 0) desc,
                 count(*) filter (where s.is_correct) desc
        limit 3`, [season]),
    matchupDetail(query, season, week),
    powerRankings(query, season, week),
    nextWeek(query, season, week),
    luckReport(query, season, week),
    allPlay(query, season, week),
    streaks(query, season, week),
    theGrudge(query, season, week),
    thisWeekInHistory(query, season, week),
    recordWatch(query, season, week),
    disputedPick(query, season, week),
  ]);

  if (games.length === 0) return null;

  return {
    season, week,
    games: games.map((game) => ({
      ...game,
      detail: detail.get(game.espn_matchup_id) ?? null,
    })),
    awards, bench, standings, predictions,
    power, nextWeek: next, luck, allPlay: all_play, streaks: streak,
    grudge, history, recordWatch: watch, disputed,
  };
}
