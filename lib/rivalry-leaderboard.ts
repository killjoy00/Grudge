export interface RivalryPairRow {
  manager_a_key: string;
  manager_a_name: string;
  manager_b_key: string;
  manager_b_name: string;
  games: number;
  manager_a_wins: number;
  manager_b_wins: number;
  ties: number;
  playoff_games: number;
  manager_a_playoff_wins: number;
  manager_b_playoff_wins: number;
  first_season: number;
  last_season: number;
}

export interface RivalryHighlights {
  mostPlayed: RivalryPairRow | null;
  closest: RivalryPairRow | null;
  domination: RivalryPairRow | null;
  playoffNemesis: RivalryPairRow | null;
}

export const winGap = (row: RivalryPairRow) => Math.abs(row.manager_a_wins - row.manager_b_wins);
export const playoffWinGap = (row: RivalryPairRow) =>
  Math.abs(row.manager_a_playoff_wins - row.manager_b_playoff_wins);

/**
 * Pick the story rows for the manager-vs-manager grudge record book.
 *
 * Closest and most one-sided lifetime series require 20 meetings so a short
 * tenure cannot win a league-history superlative because it happens to be 1-0.
 * Most-played and playoff-nemesis have no such floor because volume is already
 * part of those definitions.
 */
export function rivalryHighlights(rows: RivalryPairRow[]): RivalryHighlights {
  const byMostPlayed = [...rows].sort((a, b) =>
    b.games - a.games || winGap(a) - winGap(b) || a.manager_a_name.localeCompare(b.manager_a_name)
  );
  const established = rows.filter((row) => row.games >= 20);
  const closest = [...established].sort((a, b) =>
    winGap(a) - winGap(b) || b.games - a.games || a.manager_a_name.localeCompare(b.manager_a_name)
  );
  const domination = [...established].sort((a, b) =>
    winGap(b) - winGap(a) || b.games - a.games || a.manager_a_name.localeCompare(b.manager_a_name)
  );
  const playoff = rows.filter((row) => row.playoff_games > 0).sort((a, b) =>
    Math.max(b.manager_a_playoff_wins, b.manager_b_playoff_wins) - Math.max(a.manager_a_playoff_wins, a.manager_b_playoff_wins) ||
    playoffWinGap(b) - playoffWinGap(a) ||
    b.playoff_games - a.playoff_games ||
    a.manager_a_name.localeCompare(b.manager_a_name)
  );

  return {
    mostPlayed: byMostPlayed[0] ?? null,
    closest: closest[0] ?? null,
    domination: domination[0] ?? null,
    playoffNemesis: playoff[0] ?? null,
  };
}

export function seriesLeader(row: RivalryPairRow, playoffs = false) {
  const aWins = playoffs ? row.manager_a_playoff_wins : row.manager_a_wins;
  const bWins = playoffs ? row.manager_b_playoff_wins : row.manager_b_wins;
  if (aWins === bWins) return null;
  return aWins > bWins
    ? { id: row.manager_a_key, name: row.manager_a_name, wins: aWins, losses: bWins }
    : { id: row.manager_b_key, name: row.manager_b_name, wins: bWins, losses: aWins };
}
