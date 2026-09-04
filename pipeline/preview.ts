#!/usr/bin/env -S npx tsx
/**
 * The week ahead: ESPN's projection for every side, and the draft board.
 *
 *   npx tsx pipeline/preview.ts
 *   npx tsx pipeline/preview.ts --week=5
 *   npx tsx pipeline/preview.ts --dry-run
 *
 * WHY THIS IS NOT PART OF pipeline/run.ts. That script is built around a
 * settled week -- it fetches boxscores only for weeks ESPN has finished, and
 * everything it writes is a fact about the past. This writes a statement about
 * a week that has not happened, which is the opposite contract: it must run
 * BEFORE the games, it can never be "final", and it is worthless if it waits.
 * Keeping them apart means neither has to grow a flag explaining which kind of
 * week it is looking at.
 *
 * WHY IT IS A SNAPSHOT RATHER THAN A LIVE READ. ESPN revises projections up to
 * kickoff; a Friday injury moves them. Reading live would mean the number on
 * screen Sunday morning is not the one ESPN "predicted" on Tuesday, and a
 * record kept against it would be scored against a forecast nobody ever saw.
 * One capture a week, and that capture is both what the page shows and what
 * the record settles against.
 *
 * ESPN publishes no win probability. Its pick is the higher projected starting
 * lineup -- the same total its own matchup view shows -- and the
 * espn_matchup_picks view derives it rather than storing it, so the pick can
 * never drift from the projection it came from.
 */
import { fetchBoxscore, fetchDraft, fetchLeague } from './espn.ts';
import {
  draftPickRows, matchupProjectionRows, starterSlots,
  type DraftPickRow, type MatchupProjectionRow,
} from './normalize.ts';
import { connect, runTransaction, upsertChunked, type Stmt } from './db.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

const DRY_RUN = flag('dry-run');
const SEASON = Number(opt('season') ?? new Date().getUTCFullYear());

/**
 * Which week to project.
 *
 * ESPN's `scoringPeriodId` is the live pointer: on the Tuesday after week 3 it
 * already reads 4, which is exactly the week we want to project. Clamped to
 * 1..17 because matchup_projections has a foreign key onto `weeks`, and an out
 * of range value would otherwise fail at the very end of the transaction
 * rather than here where the message says something useful.
 */
function targetWeek(scoringPeriodId: number, override?: string): number {
  const w = override ? Number(override) : scoringPeriodId;
  if (!Number.isInteger(w) || w < 1 || w > 17) {
    throw new Error(`week ${w} is outside 1..17; ESPN reported scoringPeriodId=${scoringPeriodId}`);
  }
  return w;
}

function statements(projections: MatchupProjectionRow[], picks: DraftPickRow[]): Stmt[] {
  return [
    ...upsertChunked(
      'public.matchup_projections',
      ['season', 'week', 'espn_matchup_id', 'espn_team_id', 'projected_points', 'starters'],
      projections as unknown as Record<string, unknown>[],
      ['season', 'week', 'espn_team_id']
    ),
    ...upsertChunked(
      'public.draft_picks',
      ['season', 'overall_pick', 'round', 'round_pick', 'espn_team_id', 'espn_player_id',
       'is_keeper'],
      picks as unknown as Record<string, unknown>[],
      ['season', 'overall_pick']
    ),
  ];
}

async function main() {
  const league = await fetchLeague(SEASON);
  const week = targetWeek(league.scoringPeriodId, opt('week'));
  const starters = starterSlots(league);

  const boxscore = await fetchBoxscore(SEASON, week);
  const projections = matchupProjectionRows(boxscore, week, starters);
  console.log(`${SEASON} week ${week}: ${projections.length} side(s) projected`);
  for (const row of projections) {
    console.log(`  team ${String(row.espn_team_id).padStart(2)}  ` +
                `${row.projected_points.toFixed(1).padStart(6)}  (${row.starters} starters)`);
  }

  const draft = draftPickRows(await fetchDraft(SEASON), SEASON);
  console.log(`  draft board: ${draft.length} pick(s)`);

  // An empty projection set is not an error -- ESPN serves nothing for a week
  // beyond the schedule, and the season ends. It is also not something to
  // write: an upsert of zero rows leaves last week's capture in place, which
  // is the correct outcome, but saying so beats a silent success.
  if (projections.length === 0 && draft.length === 0) {
    console.log('nothing to write');
    return;
  }

  const batch = statements(projections, draft);
  if (DRY_RUN) {
    console.log(`--dry-run: ${batch.length} statement(s), nothing written`);
    return;
  }
  await runTransaction(connect(), batch);
  console.log(`wrote ${projections.length} projection(s) and ${draft.length} draft pick(s)`);
}

main().catch((e) => {
  console.error(`week preview failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('Nothing was written -- the run is transactional.');
  process.exit(1);
});
