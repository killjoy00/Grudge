import 'server-only';

import { asPublic } from './db.ts';

export type LeagueWireKind =
  | 'trade'
  | 'pickup'
  | 'award'
  | 'prediction'
  | 'ranking'
  | 'record'
  | 'recap';

export interface LeagueWireEvent {
  id: string;
  kind: LeagueWireKind;
  season: number;
  week: number;
  title: string;
  detail: string | null;
  href: string | null;
  happened_at: string | null;
}

const KIND_PRIORITY: Record<LeagueWireKind, number> = {
  trade: 70,
  pickup: 60,
  record: 50,
  ranking: 40,
  award: 30,
  prediction: 20,
  recap: 10,
};

function eventTime(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortEvents(a: LeagueWireEvent, b: LeagueWireEvent) {
  if (a.season !== b.season) return b.season - a.season;
  if (a.week !== b.week) return b.week - a.week;
  const time = eventTime(b.happened_at) - eventTime(a.happened_at);
  if (time !== 0) return time;
  return KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind];
}

/**
 * A compact league activity feed built entirely from records Grudge already
 * stores. It does not invent a second transaction model or derive new power
 * scores at request time; it only turns existing facts into readable events.
 */
export async function getLeagueWire(
  season: number,
  limit = 16
): Promise<LeagueWireEvent[]> {
  const [pickups, trades, awards, predictionWeeks, rankingMoves, recordWeeks, recaps] =
    await Promise.all([
      asPublic<{
        week: number;
        happened_at: string | null;
        team_name: string;
        player_name: string;
        acquisition_type: string;
        bid_amount: string | null;
      }>(
        `with adds as (
           select t.week, t.proposed_at,
                  (item ->> 'toTeamId')::int as espn_team_id,
                  (item ->> 'playerId')::bigint as espn_player_id,
                  t.type as acquisition_type,
                  t.bid_amount
             from public.transactions t
             cross join lateral jsonb_array_elements(
               coalesce(t.raw -> 'items', '[]'::jsonb)
             ) item
            where t.season = $1
              and t.status = 'EXECUTED'
              and t.type in ('WAIVER', 'FREEAGENT')
              and item ->> 'type' = 'ADD'
              and coalesce((item ->> 'toTeamId')::int, 0) > 0
         )
         select a.week,
                a.proposed_at::text as happened_at,
                coalesce(tm.name, 'Team ' || a.espn_team_id::text) as team_name,
                coalesce(p.full_name, 'Unknown player') as player_name,
                a.acquisition_type,
                case
                  when a.acquisition_type = 'WAIVER'
                    then round(coalesce(a.bid_amount, 0), 2)::text
                  when coalesce(a.bid_amount, 0) > 0
                    then round(a.bid_amount, 2)::text
                  else null
                end as bid_amount
           from adds a
           left join public.players p on p.espn_player_id = a.espn_player_id
           left join public.teams tm
             on tm.season = $1 and tm.espn_team_id = a.espn_team_id
          order by a.proposed_at desc nulls last, a.week desc, player_name
          limit 14`,
        [season]
      ),
      asPublic<{
        trade_id: string;
        week: number;
        happened_at: string | null;
        team_a_name: string;
        team_b_name: string;
        team_a_received: string | null;
        team_b_received: string | null;
      }>(
        `select t.trade_id,
                t.effective_week as week,
                t.accepted_at::text as happened_at,
                ta.name as team_a_name,
                tb.name as team_b_name,
                string_agg(
                  case when tp.to_team_id = t.team_a
                       then coalesce(p.full_name, 'Player ' || tp.espn_player_id::text)
                  end,
                  ', '
                ) filter (where tp.to_team_id = t.team_a) as team_a_received,
                string_agg(
                  case when tp.to_team_id = t.team_b
                       then coalesce(p.full_name, 'Player ' || tp.espn_player_id::text)
                  end,
                  ', '
                ) filter (where tp.to_team_id = t.team_b) as team_b_received
           from public.trades t
           join public.teams ta
             on ta.season = t.season and ta.espn_team_id = t.team_a
           join public.teams tb
             on tb.season = t.season and tb.espn_team_id = t.team_b
           left join public.trade_players tp
             on tp.season = t.season and tp.trade_id = t.trade_id
           left join public.players p on p.espn_player_id = tp.espn_player_id
          where t.season = $1
          group by t.trade_id, t.effective_week, t.accepted_at, ta.name, tb.name
          order by t.accepted_at desc nulls last, t.effective_week desc, t.trade_id
          limit 8`,
        [season]
      ),
      asPublic<{
        week: number;
        award_key: string;
        team_name: string | null;
        value: string;
      }>(
        `select a.week, a.award_key, t.name as team_name,
                round(a.value, 1)::text as value
           from public.weekly_awards a
           left join public.teams t
             on t.season = a.season and t.espn_team_id = a.espn_team_id
          where a.season = $1
            and a.award_key in ('high_scorer', 'blowout', 'nailbiter')
          order by a.week desc,
                   case a.award_key
                     when 'high_scorer' then 1
                     when 'blowout' then 2
                     else 3
                   end
          limit 18`,
        [season]
      ),
      asPublic<{
        week: number;
        leaders: string;
        correct: number;
        decided: number;
      }>(
        `with weekly as (
           select p.week, p.user_id,
                  coalesce(pr.display_name, 'Someone') as display_name,
                  count(s.prediction_id)::int as decided,
                  coalesce(sum(s.points), 0)::int as correct
             from public.predictions p
             join public.profiles pr on pr.id = p.user_id
             join public.prediction_scores s on s.prediction_id = p.id
            where p.season = $1
            group by p.week, p.user_id, pr.display_name
         ), ranked as (
           select weekly.*,
                  dense_rank() over (
                    partition by week
                    order by correct desc, decided desc
                  ) as place
             from weekly
         )
         select week,
                string_agg(display_name, ', ' order by display_name) as leaders,
                max(correct)::int as correct,
                max(decided)::int as decided
           from ranked
          where place = 1 and decided > 0
          group by week
          order by week desc
          limit 6`,
        [season]
      ),
      asPublic<{
        week: number;
        team_name: string;
        previous_rank: number;
        rank: number;
      }>(
        `with moves as (
           select p.week, p.espn_team_id, p.rank,
                  lag(p.rank) over (
                    partition by p.espn_team_id order by p.week
                  ) as previous_rank
             from public.power_rankings p
            where p.season = $1
         )
         select m.week, t.name as team_name,
                m.previous_rank::int as previous_rank,
                m.rank::int as rank
           from moves m
           join public.teams t
             on t.season = $1 and t.espn_team_id = m.espn_team_id
          where m.previous_rank is not null
            and abs(m.previous_rank - m.rank) >= 2
          order by m.week desc,
                   abs(m.previous_rank - m.rank) desc,
                   t.name
          limit 10`,
        [season]
      ),
      asPublic<{
        week: number;
        team_names: string;
        points: string;
      }>(
        `with weekly as (
           select season, week, max(points_for) as max_points
             from public.team_week_results
            group by season, week
         ), record_weeks as (
           select weekly.*,
                  max(max_points) over (
                    order by season, week
                    rows between unbounded preceding and 1 preceding
                  ) as previous_record
             from weekly
         )
         select rw.week,
                string_agg(t.name, ', ' order by t.name) as team_names,
                round(rw.max_points, 1)::text as points
           from record_weeks rw
           join public.team_week_results r
             on r.season = rw.season
            and r.week = rw.week
            and r.points_for = rw.max_points
           join public.teams t
             on t.season = r.season and t.espn_team_id = r.espn_team_id
          where rw.season = $1
            and rw.max_points > coalesce(rw.previous_record, -1)
          group by rw.week, rw.max_points
          order by rw.week desc
          limit 5`,
        [season]
      ),
      asPublic<{ week: number }>(
        `select week
           from public.weeks
          where season = $1 and results_complete
          order by week desc
          limit 4`,
        [season]
      ),
    ]);

  const events: LeagueWireEvent[] = [];

  for (const row of pickups) {
    const method = row.acquisition_type === 'WAIVER' ? 'waivers' : 'free agency';
    const spend = row.bid_amount === null
      ? null
      : `$${Number(row.bid_amount).toFixed(2)} FAAB`;
    events.push({
      id: `pickup:${row.week}:${row.team_name}:${row.player_name}:${row.happened_at ?? ''}`,
      kind: 'pickup',
      season,
      week: row.week,
      happened_at: row.happened_at,
      title: `${row.team_name} added ${row.player_name}`,
      detail: `${method}${spend ? ` · ${spend}` : ''}`,
      href: null,
    });
  }

  for (const row of trades) {
    const details = [
      `${row.team_a_name} received ${row.team_a_received ?? '—'}`,
      `${row.team_b_name} received ${row.team_b_received ?? '—'}`,
    ].join(' · ');
    events.push({
      id: `trade:${row.trade_id}`,
      kind: 'trade',
      season,
      week: row.week,
      happened_at: row.happened_at,
      title: `${row.team_a_name} and ${row.team_b_name} made a trade`,
      detail: details,
      href: '/trades',
    });
  }

  for (const row of awards) {
    let title = `${row.team_name ?? 'A team'} took a weekly award`;
    let detail = row.value;
    if (row.award_key === 'high_scorer') {
      title = `${row.team_name ?? 'A team'} led the league with ${row.value}`;
      detail = 'Highest score of the week';
    } else if (row.award_key === 'blowout') {
      title = `${row.team_name ?? 'A team'} delivered a ${row.value}-point blowout`;
      detail = 'Biggest margin of the week';
    } else if (row.award_key === 'nailbiter') {
      title = `${row.team_name ?? 'A team'} lost by just ${row.value}`;
      detail = 'Closest loss of the week';
    }
    events.push({
      id: `award:${row.week}:${row.award_key}`,
      kind: 'award',
      season,
      week: row.week,
      happened_at: null,
      title,
      detail,
      href: `/standings/recaps/${season}/${row.week}`,
    });
  }

  for (const row of predictionWeeks) {
    const tied = row.leaders.includes(', ');
    events.push({
      id: `prediction:${row.week}`,
      kind: 'prediction',
      season,
      week: row.week,
      happened_at: null,
      title: `${row.leaders} ${tied ? 'led' : 'won'} the prediction week`,
      detail: `${row.correct} correct across ${row.decided} scored pick${row.decided === 1 ? '' : 's'}`,
      href: '/predictions',
    });
  }

  for (const row of rankingMoves) {
    const climbed = row.rank < row.previous_rank;
    events.push({
      id: `ranking:${row.week}:${row.team_name}`,
      kind: 'ranking',
      season,
      week: row.week,
      happened_at: null,
      title: `${row.team_name} ${climbed ? 'jumped' : 'fell'} ${Math.abs(row.previous_rank - row.rank)} spots`,
      detail: `Power ranking #${row.previous_rank} → #${row.rank}`,
      href: `/rankings?season=${season}`,
    });
  }

  for (const row of recordWeeks) {
    events.push({
      id: `record:${row.week}:${row.points}`,
      kind: 'record',
      season,
      week: row.week,
      happened_at: null,
      title: `${row.team_names} set a new all-time weekly scoring record`,
      detail: `${row.points} points`,
      href: '/history/records',
    });
  }

  for (const row of recaps) {
    events.push({
      id: `recap:${row.week}`,
      kind: 'recap',
      season,
      week: row.week,
      happened_at: null,
      title: `Week ${row.week} is in the books`,
      detail: 'Final scores, awards, bench decisions and the weekly receipts are filed.',
      href: `/standings/recaps/${season}/${row.week}`,
    });
  }

  return events.sort(sortEvents).slice(0, Math.max(1, limit));
}
