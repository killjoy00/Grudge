#!/usr/bin/env -S npx tsx
/**
 * The week ahead: ESPN's projection for every side, and the draft board.
 *
 *   npx tsx pipeline/preview.ts
 *   npx tsx pipeline/preview.ts --week=5
 *   npx tsx pipeline/preview.ts --dry-run
 *   npx tsx pipeline/preview.ts --week=5 --recapture  # explicit evidence replacement
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
 * screen Sunday morning is not the one ESPN showed when Grudge captured it,
 * and a record kept against it would be scored against a forecast nobody ever
 * saw. The first complete capture is therefore immutable. Routine weekly or
 * verification reruns may refresh reference data, but they cannot replace the
 * stored line. A deliberate --recapture is the only exception, and it moves
 * captured_at together with the values so provenance stays truthful.
 *
 * ESPN publishes no win probability. Its pick is the higher projected starting
 * lineup -- the same total its own matchup view shows -- and the
 * espn_matchup_picks view derives it rather than storing it, so the pick can
 * never drift from the projection it came from.
 */
import { fetchBoxscore, fetchDraft, fetchLeague } from './espn.ts';
import { draftPickRows, matchupProjectionRows, starterSlots } from './normalize.ts';
import { connect, runTransaction } from './db.ts';
import { previewStatements } from './preview-write.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

const DRY_RUN = flag('dry-run');
const RECAPTURE = flag('recapture');
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

  // Never freeze a partial league snapshot. A transactional write protects us
  // from half a database transaction, but this protects us from a complete
  // transaction built from an incomplete ESPN response.
  const teamCount = league.teams?.length ?? 0;
  if (projections.length > 0 && teamCount > 0 && projections.length !== teamCount) {
    throw new Error(
      `refusing partial projection snapshot: ESPN returned ${projections.length} side(s) for ${teamCount} teams`,
    );
  }

  const draft = draftPickRows(await fetchDraft(SEASON), SEASON);
  console.log(`  draft board: ${draft.length} pick(s)`);

  // An empty projection set is not an error -- ESPN serves nothing for a week
  // beyond the schedule, and the season ends. Draft reference data and the
  // canonical player-name repair can still be useful, so only a fully empty
  // batch is skipped by runTransaction itself.
  if (projections.length === 0 && draft.length === 0) {
    console.log('no projection or draft rows; canonical player cache will still be checked');
  }

  const capturedAt = new Date().toISOString();
  const batch = previewStatements(projections, draft, SEASON, capturedAt, RECAPTURE);
  if (DRY_RUN) {
    console.log(`--dry-run: ${batch.length} statement(s), nothing written`);
    return;
  }

  if (RECAPTURE) {
    console.warn(
      `RECAPTURE requested for ${SEASON} week ${week}: existing projection evidence and captured_at may be replaced`,
    );
  }

  await runTransaction(connect(), batch);
  console.log(
    RECAPTURE
      ? `recaptured ${projections.length} projection side(s); refreshed ${draft.length} draft pick(s)`
      : `preserved existing weekly line or inserted first capture for ${projections.length} side(s); refreshed ${draft.length} draft pick(s)`,
  );
}

main().catch((e) => {
  console.error(`week preview failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('Nothing was written -- the run is transactional.');
  process.exit(1);
});
