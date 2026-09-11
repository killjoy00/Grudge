/** Pure SQL builders: the page and PostgreSQL execution tests use these alike. */
import { PLAYER_STATS, SORT_OPTIONS, type PlayerFilters } from './player-data.ts';
import { trackedMatchupSql } from './playoff-policy.ts';

const STAT_SUMS = PLAYER_STATS.map(([key]) => `sum((g.stats->>'${key}')::numeric)::text as ${key}`).join(',\n');
const TOTALS = `count(g.player_key)::int as games,
  case when count(g.player_key) = count(g.fantasy_points) then round(sum(g.fantasy_points), 2)::text end as points,
  case when count(g.player_key) = count(g.fantasy_points) then round(avg(g.fantasy_points), 2)::text end as average,
  count(*) filter (where g.score_evidence = 'observed')::int as observed,
  count(*) filter (where g.score_evidence = 'reconstructed')::int as rebuilt,
  count(*) filter (where g.score_evidence in ('unavailable', 'conflict'))::int as unavailable,
  ${STAT_SUMS}`;

export function playerListQuery(f: PlayerFilters) {
  const sort = SORT_OPTIONS.some(([k]) => k === f.sort) ? f.sort : 'points';
  const direction = f.direction === 'asc' ? 'asc' : 'desc';
  return { text: `with totals as (
    select s.player_key, p.full_name, s.position, s.teams, ${TOTALS}
    from public.nfl_player_seasons s join public.nfl_players p using (player_key)
    left join public.nfl_player_games g on g.season = s.season and g.player_key = s.player_key
      and g.season_type = $2 and g.week between $3 and $4
    where s.season = $1 and ($5 = '' or s.position = $5)
      and ($6 = '' or strpos(lower(p.full_name || ' ' || coalesce(p.bio->>'aliases', '')), lower($6)) > 0)
    group by s.player_key, p.full_name, s.position, s.teams
  ) select *, count(*) over ()::int as total_count from totals
    order by ${sort === 'full_name' ? 'full_name' : `${sort}::numeric`} ${direction} nulls last, full_name, player_key
    limit 50 offset $7`, params: [f.season, f.period, f.from, f.to, f.position, f.q, (f.page - 1) * 50] };
}

export const PLAYER_CAREER_SQL = `select s.season, s.position, s.teams, ${TOTALS}
  from public.nfl_player_seasons s left join public.nfl_player_games g
    on g.season = s.season and g.player_key = s.player_key and g.season_type = $2
  where s.player_key = $1 group by s.season, s.position, s.teams order by s.season desc`;

// Stints describe observed weekly snapshots, including bench and IR. They do
// not infer transactions at the boundaries or credit consolation production.
export const PLAYER_HISTORY_SQL = `with aliases as (
  select season, espn_player_id from public.nfl_player_aliases where player_key = $1
), snapshots as (
  select distinct r.season, r.week, r.espn_team_id
  from public.roster_entries r join aliases a using (season, espn_player_id)
), islands as (
  select *, week - row_number() over (partition by season, espn_team_id order by week) as grp from snapshots
), stints as (
  select season, espn_team_id, min(week)::int as week, max(week)::int as end_week
  from islands group by season, espn_team_id, grp
), events as (
  select 'draft:'||d.season||':'||d.overall_pick as event_key, d.season, null::int as week, null::int as end_week,
    'draft'::text as kind, d.espn_team_id as team_id, null::int as other_team_id,
    'Round '||d.round||' · Pick '||d.overall_pick as detail, null::timestamptz as occurred_at, 'recorded'::text as evidence
  from public.draft_picks d join aliases a using (season, espn_player_id)
  union all
  select 'trade:'||t.season||':'||t.trade_id, t.season, t.effective_week, null, 'trade',
    p.to_team_id, p.from_team_id, t.trade_id, t.accepted_at, t.confidence
  from public.trade_players p
    join public.trades t on t.season = p.season and t.trade_id = p.trade_id
  where p.player_key = $1 and t.evidence_status = 'active'
  union all
  select 'transaction:'||t.espn_transaction_id||':'||i.item_index, t.season, t.week, null,
    case when i.item_type = 'DROP' then 'drop' when t.type = 'WAIVER' then 'waiver' else 'add' end,
    case when i.item_type = 'DROP' then i.from_team_id else i.to_team_id end, null, null,
    case when t.raw->>'processDate' ~ '^[0-9]{10,16}$' and (t.raw->>'processDate')::numeric > 0
      then to_timestamp((t.raw->>'processDate')::numeric / 1000) end, 'recorded'
  from public.transactions t join public.transaction_items i using (espn_transaction_id)
    join aliases a on a.season = t.season and a.espn_player_id = coalesce(i.espn_player_id,
      case when t.raw->'items'->i.item_index->>'playerId' ~ '^-?[0-9]+$'
        then (t.raw->'items'->i.item_index->>'playerId')::bigint end)
  where t.status = 'EXECUTED' and not t.is_pending and t.type in ('FREEAGENT', 'WAIVER', 'ROSTER')
    and i.item_type in ('ADD', 'DROP')
  union all
  select 'roster:'||season||':'||espn_team_id||':'||week, season, week, end_week, 'roster', espn_team_id,
    null, null, null, 'snapshot' from stints
  union all
  select 'archive:'||r.season||':'||r.espn_team_id, r.season, null, null, r.snapshot_kind||'_roster',
    r.espn_team_id, null, null, null, 'snapshot'
  from public.player_archive_rosters r where r.player_key = $1
    and not exists (select 1 from snapshots s where s.season = r.season)
)
select e.*, tf.team_name, tf.franchise_key, coalesce(owners.names, current_owners.names) as managers,
  otf.team_name as other_team_name, coalesce(other_owners.names, current_other_owners.names) as other_managers
from events e left join public.team_franchise tf on tf.season = e.season and tf.espn_team_id = e.team_id
left join public.team_franchise otf on otf.season = e.season and otf.espn_team_id = e.other_team_id
left join lateral (select string_agg(m.display_name, ', ' order by m.display_name) as names
  from public.manager_franchise_seasons ms join public.managers m using(manager_key)
  where ms.season = e.season and ms.franchise_key = tf.franchise_key) owners on true
left join lateral (select string_agg(m.display_name, ', ' order by m.display_name) as names
  from public.manager_franchise_seasons ms join public.managers m using(manager_key)
  where ms.season = e.season and ms.franchise_key = otf.franchise_key) other_owners on true
left join lateral (select string_agg(coalesce(nullif(concat_ws(' ', m.first_name, m.last_name), ''), m.display_name), ', ' order by m.swid) as names
  from public.team_owners o join public.members m using (season, swid)
  where o.season = e.season and o.espn_team_id = e.team_id) current_owners on true
left join lateral (select string_agg(coalesce(nullif(concat_ws(' ', m.first_name, m.last_name), ''), m.display_name), ', ' order by m.swid) as names
  from public.team_owners o join public.members m using (season, swid)
  where o.season = e.season and o.espn_team_id = e.other_team_id) current_other_owners on true
order by e.season asc,
  coalesce(e.week, case when e.kind = 'draft' then 0 else 99 end) asc,
  case e.kind
    when 'draft' then 0
    when 'waiver' then 1
    when 'add' then 1
    when 'trade' then 1
    when 'roster' then 2
    when 'drop' then 3
    when 'final_roster' then 4
    when 'current_roster' then 4
    else 2
  end asc,
  e.occurred_at asc nulls last, e.event_key asc`;

export const PLAYER_CONTRIBUTIONS_SQL = `select r.season, tf.team_name, tf.franchise_key,
  count(*)::int as roster_weeks, count(*) filter (where r.is_starter)::int as starts,
  case when count(*) filter (where r.is_starter) = count(s.points) filter (where r.is_starter)
    then round(coalesce(sum(s.points) filter (where r.is_starter), 0), 2)::text end as points
  from public.roster_entries r join public.nfl_player_aliases a using (season, espn_player_id)
  join public.weeks w on w.season = r.season and w.week = r.week and w.results_complete
  left join public.player_week_scores s
    on s.season = r.season and s.week = r.week and s.player_key = a.player_key
  left join public.team_franchise tf on tf.season = r.season and tf.espn_team_id = r.espn_team_id
  where a.player_key = $1 and exists (select 1 from public.matchups m where m.season = r.season and m.week = r.week
    and r.espn_team_id in (m.home_team_id, m.away_team_id) and ${trackedMatchupSql('m')})
  group by r.season, r.espn_team_id, tf.team_name, tf.franchise_key order by r.season desc, tf.team_name`;
