import { stmt, type Stmt } from './db.ts';
import type { EspnLeague, EspnMatchupSide } from './espn.ts';
import { matchupRows, starterCount, starterSlots, type MatchupRow } from './normalize.ts';

export interface ExistingMatchupShape {
  espn_matchup_id: number;
  home_team_id: number;
  away_team_id: number;
}

const roundScore = (value: number) => Math.round(value * 100) / 100;

/**
 * ESPN's season-level mMatchupScore view can leave totalPoints at its preseason
 * zero during an in-progress week. mBoxscore has the per-player applied totals
 * we already trust for weekly roster evidence, so use those as the fallback.
 *
 * A non-zero provider team total wins because it can include league-level score
 * adjustments. If that total is still zero, only accept a computed total when
 * the boxscore contains the full legal set of starters and every starter has a
 * finite appliedStatTotal. That keeps this snapshot from silently publishing a
 * partial lineup if ESPN serves a truncated payload.
 */
function currentSideScore(
  side: EspnMatchupSide,
  starters: Set<number>,
  expectedStarters: number,
): number | null {
  const provider = side.totalPoints;
  if (typeof provider === 'number' && Number.isFinite(provider) && provider !== 0) {
    return roundScore(provider);
  }

  const starterEntries = (side.rosterForCurrentScoringPeriod?.entries ?? [])
    .filter((entry) => starters.has(entry.lineupSlotId));
  const values = starterEntries.map((entry) => entry.playerPoolEntry?.appliedStatTotal);
  const complete = starterEntries.length === expectedStarters
    && values.every((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (complete) return roundScore(values.reduce((sum, value) => sum + value, 0));

  return typeof provider === 'number' && Number.isFinite(provider)
    ? roundScore(provider)
    : null;
}

/** Build the active score slate from mBoxscore rather than stale season totals. */
export function scoreboardRowsFromBoxscore(
  league: EspnLeague,
  boxscore: EspnLeague,
  week: number,
): MatchupRow[] {
  const starters = starterSlots(league);
  const expectedStarters = starterCount(league);
  const rawById = new Map(
    (boxscore.schedule ?? [])
      .filter((matchup) => matchup.matchupPeriodId === week)
      .map((matchup) => [matchup.id, matchup]),
  );

  return matchupRows(boxscore)
    .filter((row) => row.week === week)
    .map((row) => {
      const raw = rawById.get(row.espn_matchup_id);
      if (!raw?.home || !raw.away) {
        throw new Error(`ESPN boxscore is missing matchup ${row.espn_matchup_id} sides.`);
      }
      return {
        ...row,
        home_points: currentSideScore(raw.home, starters, expectedStarters),
        away_points: currentSideScore(raw.away, starters, expectedStarters),
      };
    });
}

/** Never let a Monday job report success after writing a slate of stale zeroes. */
export function assertMeaningfulScoreSnapshot(rows: MatchupRow[]): void {
  if (rows.length === 0) throw new Error('ESPN boxscore returned no active-week matchups.');
  if (rows.some((row) => row.home_points == null || row.away_points == null)) {
    throw new Error('ESPN boxscore did not contain complete score values for every matchup.');
  }
  if (!rows.some((row) => Number(row.home_points) !== 0 || Number(row.away_points) !== 0)) {
    throw new Error('ESPN boxscore still contains an all-zero score slate; refusing to publish it.');
  }
}

/**
 * The Monday snapshot is deliberately narrow: only the two score columns move.
 * The weekly pipeline remains the only process allowed to decide winners,
 * finalize matchups/weeks, build roster evidence, or compute season results.
 */
export function scoreboardRefreshStatements(rows: MatchupRow[]): Stmt[] {
  return rows.map((row) => stmt(
    `update public.matchups
        set home_points = $1,
            away_points = $2
      where season = $3
        and week = $4
        and espn_matchup_id = $5
        and home_team_id = $6
        and away_team_id = $7`,
    [
      row.home_points,
      row.away_points,
      row.season,
      row.week,
      row.espn_matchup_id,
      row.home_team_id,
      row.away_team_id,
    ]
  ));
}

/** Fail closed if ESPN's current slate no longer matches the schedule on file. */
export function assertSameSlate(existing: ExistingMatchupShape[], incoming: MatchupRow[]): void {
  const key = (row: ExistingMatchupShape) =>
    `${row.espn_matchup_id}:${row.away_team_id}:${row.home_team_id}`;
  const a = [...existing].map(key).sort();
  const b = [...incoming].map(key).sort();
  if (a.length === 0) throw new Error('No matchup slate exists in the database for the active week.');
  if (a.length !== b.length || a.some((value, i) => value !== b[i])) {
    throw new Error(
      `ESPN active-week slate does not match the database (${a.length} stored vs ${b.length} fetched); refusing partial score refresh.`
    );
  }
}
