#!/usr/bin/env -S npx tsx
/**
 * Weekly free-agent pool snapshot.
 *
 *   npx tsx pipeline/ownership.ts
 *   npx tsx pipeline/ownership.ts --week=5 --limit=400
 *   npx tsx pipeline/ownership.ts --dry-run
 *
 * WHY A SNAPSHOT RATHER THAN A LIVE FETCH. ESPN serves ownership as a moving
 * point-in-time value with no history. "Who is being picked up right now" is
 * only answerable by keeping our own series, so this runs weekly and the
 * interesting number -- the delta -- is computed from two of our rows rather
 * than trusted from one of theirs.
 *
 * ESPN's own `percentChange` is stored alongside, deliberately. It gives an
 * independent second opinion on the same question, so a bug in our snapshot
 * cadence shows up as the two series disagreeing instead of as a plausible
 * wrong answer.
 *
 * Unlike the main pipeline this is NOT gated on week completeness. A waiver
 * trend mid-week is the whole point; there is nothing to be "final" about.
 */
import { fetchFreeAgents, fetchLeague } from './espn.ts';
import { freeAgentRows, type FreeAgentRow } from './normalize.ts';
import { connect, runTransaction, upsertChunked, type Stmt } from './db.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

const DRY_RUN = flag('dry-run');
const SEASON = Number(opt('season') ?? new Date().getUTCFullYear());
const LIMIT = Number(opt('limit') ?? 300);

/**
 * Which week to file the snapshot under.
 *
 * ESPN's `scoringPeriodId` is the live pointer and is what we want: a snapshot
 * taken on Tuesday describes the pool going INTO the upcoming week. Clamped to
 * 1..17 because player_ownership_snapshots has a foreign key onto weeks, and an
 * out-of-range value would fail the whole transaction at the very end rather
 * than here where the message is useful.
 */
function targetWeek(scoringPeriodId: number, override?: string): number {
  const w = override ? Number(override) : scoringPeriodId;
  if (!Number.isInteger(w) || w < 1 || w > 17) {
    throw new Error(`week ${w} is outside 1..17; ESPN reported scoringPeriodId=${scoringPeriodId}`);
  }
  return w;
}

function statements(season: number, week: number, rows: FreeAgentRow[]): Stmt[] {
  // Players first, and in the SAME transaction. Free agents are by definition
  // not on any roster, so most of them do not yet exist in `players` -- which
  // player_ownership_snapshots has a foreign key onto. Loading the snapshot
  // without this fails on the first genuinely-unowned player.
  const players = rows.map((r) => ({
    espn_player_id: r.espn_player_id,
    full_name: r.full_name,
    default_position_id: r.default_position_id,
    pro_team_id: r.pro_team_id,
  }));

  const snapshots = rows.map((r) => ({
    season,
    week,
    espn_player_id: r.espn_player_id,
    percent_owned: r.percent_owned,
    percent_change: r.percent_change,
    percent_started: r.percent_started,
    auction_value_avg: r.auction_value_avg,
    avg_draft_position: r.avg_draft_position,
    status: r.status,
    on_team_id: r.on_team_id,
  }));

  return [
    ...upsertChunked(
      'public.players',
      ['espn_player_id', 'full_name', 'default_position_id', 'pro_team_id'],
      players,
      ['espn_player_id']
    ),
    ...upsertChunked(
      'public.player_ownership_snapshots',
      ['season', 'week', 'espn_player_id', 'percent_owned', 'percent_change',
       'percent_started', 'auction_value_avg', 'avg_draft_position', 'status', 'on_team_id'],
      snapshots,
      ['season', 'week', 'espn_player_id']
    ),
  ];
}

async function main() {
  // The league call is what tells us the current scoring period. Doing it first
  // also means an ESPN outage fails before anything is written.
  const league = await fetchLeague(SEASON);
  const week = targetWeek(league.scoringPeriodId, opt('week'));

  const payload = await fetchFreeAgents(SEASON, LIMIT);
  const rows = freeAgentRows(payload);

  console.log(`${SEASON} week ${week}: ${rows.length} pool player(s) from ESPN`);
  if (rows.length === 0) {
    // Not an error worth failing on -- but not something to write, either. An
    // empty snapshot would read downstream as "the pool emptied".
    console.log('empty pool response; nothing written');
    return;
  }

  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.status ?? 'null', (seen.get(r.status ?? 'null') ?? 0) + 1);
  console.log(`  status: ${[...seen].map(([k, v]) => `${k}=${v}`).join(' ')}`);

  const batch = statements(SEASON, week, rows);
  if (DRY_RUN) {
    console.log(`--dry-run: ${batch.length} statement(s), nothing written`);
    return;
  }

  await runTransaction(connect(), batch);
  console.log(`wrote ${rows.length} snapshot row(s) for ${SEASON} week ${week}`);
}

main().catch((e) => {
  console.error(`ownership snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('Nothing was written -- the run is transactional.');
  process.exit(1);
});
