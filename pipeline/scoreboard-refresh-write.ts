import { stmt, type Stmt } from './db.ts';
import type { MatchupRow } from './normalize.ts';

export interface ExistingMatchupShape {
  espn_matchup_id: number;
  home_team_id: number;
  away_team_id: number;
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
