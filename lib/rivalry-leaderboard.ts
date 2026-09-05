export interface RivalryPairRow {
  team_a_id: number;
  team_a_name: string;
  team_b_id: number;
  team_b_name: string;
  games: number;
  team_a_wins: number;
  team_b_wins: number;
  ties: number;
  playoff_games: number;
  team_a_playoff_wins: number;
  team_b_playoff_wins: number;
  first_season: number;
  last_season: number;
}

export interface RivalryHighlights {
  mostPlayed: RivalryPairRow | null;
  closest: RivalryPairRow | null;
  domination: RivalryPairRow | null;
  playoffNemesis: RivalryPairRow | null;
}

export const winGap = (row: RivalryPairRow) => Math.abs(row.team_a_wins - row.team_b_wins);
export const playoffWinGap = (row: RivalryPairRow) =>
  Math.abs(row.team_a_playoff_wins - row.team_b_playoff_wins);

/**
 * Pick the story rows for the rivalry record book.
 *
 * Closest and most one-sided lifetime series require 20 meetings so a young
 * matchup cannot win a league-history superlative because it happens to be
 * 1-0. Most-played and playoff-nemesis have no such floor because volume is
 * already part of those definitions.
 */
export function rivalryHighlights(rows: RivalryPairRow[]): RivalryHighlights {
  const byMostPlayed = [...rows].sort((a, b) =>
    b.games - a.games || winGap(a) - winGap(b) || a.team_a_name.localeCompare(b.team_a_name)
  );
  const established = rows.filter((row) => row.games >= 20);
  const closest = [...established].sort((a, b) =>
    winGap(a) - winGap(b) || b.games - a.games || a.team_a_name.localeCompare(b.team_a_name)
  );
  const domination = [...established].sort((a, b) =>
    winGap(b) - winGap(a) || b.games - a.games || a.team_a_name.localeCompare(b.team_a_name)
  );
  const playoff = rows.filter((row) => row.playoff_games > 0).sort((a, b) =>
    Math.max(b.team_a_playoff_wins, b.team_b_playoff_wins) - Math.max(a.team_a_playoff_wins, a.team_b_playoff_wins) ||
    playoffWinGap(b) - playoffWinGap(a) ||
    b.playoff_games - a.playoff_games ||
    a.team_a_name.localeCompare(b.team_a_name)
  );

  return {
    mostPlayed: byMostPlayed[0] ?? null,
    closest: closest[0] ?? null,
    domination: domination[0] ?? null,
    playoffNemesis: playoff[0] ?? null,
  };
}

export function seriesLeader(row: RivalryPairRow, playoffs = false) {
  const aWins = playoffs ? row.team_a_playoff_wins : row.team_a_wins;
  const bWins = playoffs ? row.team_b_playoff_wins : row.team_b_wins;
  if (aWins === bWins) return null;
  return aWins > bWins
    ? { id: row.team_a_id, name: row.team_a_name, wins: aWins, losses: bWins }
    : { id: row.team_b_id, name: row.team_b_name, wins: bWins, losses: aWins };
}
