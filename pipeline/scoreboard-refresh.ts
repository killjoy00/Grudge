#!/usr/bin/env -S npx tsx
/**
 * Monday score snapshot.
 *
 * This is intentionally NOT the weekly pipeline. It reads ESPN's current
 * boxscore totals and updates only home_points/away_points for the first started,
 * incomplete week already on file. It never marks a matchup or week final,
 * never writes roster/player evidence, and never recomputes standings or awards.
 * Tuesday remains the canonical settlement run.
 */
import { connect, runTransaction } from './db.ts';
import { fetchBoxscore, fetchLeague } from './espn.ts';
import {
  assertMeaningfulScoreSnapshot,
  assertSameSlate,
  scoreboardRefreshStatements,
  scoreboardRowsFromBoxscore,
  type ExistingMatchupShape,
} from './scoreboard-refresh-write.ts';

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const SEASON = Number(opt('season', String(new Date().getUTCFullYear())));

type Queryable = {
  query: <T>(text: string, params: unknown[]) => Promise<T[]>;
};

interface ActiveWeek {
  week: number;
}

async function main() {
  if (!Number.isInteger(SEASON) || SEASON < 2000) throw new Error(`Invalid season: ${SEASON}`);

  const sql = connect();
  const q = sql as unknown as Queryable;
  const active = await q.query<ActiveWeek>(
    `select week
       from public.weeks
      where season = $1
        and not results_complete
        and first_kickoff_at is not null
        and first_kickoff_at <= now()
      order by week
      limit 1`,
    [SEASON]
  );
  const week = active[0]?.week;
  if (!week) {
    console.log(`${SEASON}: no started incomplete week; scoreboard refresh is a no-op.`);
    return;
  }

  const existing = await q.query<ExistingMatchupShape>(
    `select espn_matchup_id, home_team_id, away_team_id
       from public.matchups
      where season = $1 and week = $2
      order by espn_matchup_id`,
    [SEASON, week]
  );

  const [league, boxscore] = await Promise.all([
    fetchLeague(SEASON),
    fetchBoxscore(SEASON, week),
  ]);
  league.seasonId ??= SEASON;
  boxscore.seasonId ??= SEASON;
  const incoming = scoreboardRowsFromBoxscore(league, boxscore, week)
    .sort((a, b) => a.espn_matchup_id - b.espn_matchup_id);

  assertSameSlate(existing, incoming);
  assertMeaningfulScoreSnapshot(incoming);
  await runTransaction(sql, scoreboardRefreshStatements(incoming));

  console.log(
    `${SEASON} week ${week}: refreshed ${incoming.length} matchup score lines from mBoxscore.`
  );
  console.log(
    incoming.map((row) =>
      `${row.espn_matchup_id}:${row.away_points ?? '—'}-${row.home_points ?? '—'}`
    ).join(' ')
  );
  console.log('No winners, final flags, week status, rosters, standings, awards, or predictions were changed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
