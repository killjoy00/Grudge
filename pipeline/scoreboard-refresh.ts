#!/usr/bin/env -S npx tsx
/**
 * Monday score snapshot.
 *
 * This is intentionally NOT the weekly pipeline. It reads ESPN's current
 * matchup totals and updates only home_points/away_points for the first started,
 * incomplete week already on file. It never marks a matchup or week final,
 * never writes roster/player evidence, and never recomputes standings or awards.
 * Tuesday remains the canonical settlement run.
 */
import { connect, runTransaction } from './db.ts';
import { fetchLeague } from './espn.ts';
import { matchupRows } from './normalize.ts';
import {
  assertSameSlate,
  scoreboardRefreshStatements,
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

  const league = await fetchLeague(SEASON);
  league.seasonId ??= SEASON;
  const incoming = matchupRows(league)
    .filter((row) => row.week === week)
    .sort((a, b) => a.espn_matchup_id - b.espn_matchup_id);

  assertSameSlate(existing, incoming);
  await runTransaction(sql, scoreboardRefreshStatements(incoming));

  const withScores = incoming.filter(
    (row) => row.home_points != null || row.away_points != null
  ).length;
  console.log(
    `${SEASON} week ${week}: refreshed ${incoming.length} matchup score lines (${withScores} with score values).`
  );
  console.log('No winners, final flags, week status, rosters, standings, awards, or predictions were changed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
