/**
 * The 2005-2017 archive: what the recovered spreadsheet says, and how it turns
 * into the rows `scripts/import-manual-history.ts` loads.
 *
 * `data/manual-history/standings-2005-2017.csv` is a straight transcription of
 * the spreadsheet -- one row per team per season, in the order the league
 * finished. Everything derived from it (playoff records, champion flags) is
 * computed here so the derivation is reviewable and testable rather than typed
 * into a CSV by hand.
 */

import { parseCsv } from './manual-history.ts';
import type { ManualSeasonResult } from './manual-history.ts';
import { derivePlayoffRecords, PLAYOFF_FIELD } from './playoff-bracket.ts';

export interface StandingRow {
  season: number;
  final_place: number;
  franchise_key: string;
  team_name: string;
  manager_label: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  moves: number;
}

/**
 * Seasons whose byes cannot come from the overall standings.
 *
 * 2006 is the only one. Boston Baked Beans finished tied for the league's best
 * record at 9-4 yet lost in the first round, which is impossible if the two
 * best records take the byes. A two-division season explains it and has exactly
 * one solution: The Penguins (9-4) and Your Worst Nightmares (8-5) win the
 * divisions and take the byes, leaving Boston as the 3 seed. Every other
 * season's finish order fits standings-order seeding directly.
 */
export const SEASON_BYES: Record<number, string[]> = {
  2006: ['the-penguins', 'your-worst-nightmares'],
};

const SOURCE = 'League archive spreadsheet, 2005-2017 final standings and playoff finish order';

export function parseStandings(text: string): StandingRow[] {
  const number = (row: Record<string, string>, column: string, line: number) => {
    const parsed = Number(row[column]);
    if (!Number.isFinite(parsed)) throw new Error(`Row ${line}: ${column} must be a number.`);
    return parsed;
  };
  return parseCsv(text).map((row, index) => {
    const line = index + 2;
    const parsed: StandingRow = {
      season: number(row, 'season', line),
      final_place: number(row, 'final_place', line),
      franchise_key: row.franchise_key ?? '',
      team_name: row.team_name ?? '',
      manager_label: row.manager_label ?? '',
      wins: number(row, 'wins', line),
      losses: number(row, 'losses', line),
      ties: number(row, 'ties', line),
      points_for: number(row, 'points_for', line),
      points_against: number(row, 'points_against', line),
      moves: number(row, 'moves', line),
    };
    if (!parsed.franchise_key) throw new Error(`Row ${line}: franchise_key is required.`);
    if (!parsed.team_name) throw new Error(`Row ${line}: team_name is required.`);
    return parsed;
  });
}

export function groupBySeason(rows: StandingRow[]): Map<number, StandingRow[]> {
  const seasons = new Map<number, StandingRow[]>();
  for (const row of rows) {
    const bucket = seasons.get(row.season);
    if (bucket) bucket.push(row);
    else seasons.set(row.season, [row]);
  }
  for (const [season, teams] of seasons) {
    const places = new Set(teams.map((team) => team.final_place));
    if (places.size !== teams.length) throw new Error(`${season}: duplicate final_place.`);
    const franchises = new Set(teams.map((team) => team.franchise_key));
    if (franchises.size !== teams.length) throw new Error(`${season}: a franchise appears twice.`);
    for (let place = 1; place <= teams.length; place++) {
      if (!places.has(place)) throw new Error(`${season}: no team finished ${place}.`);
    }
  }
  return seasons;
}

export function buildSeasonResults(rows: StandingRow[]): ManualSeasonResult[] {
  const results: ManualSeasonResult[] = [];
  for (const [season, teams] of groupBySeason(rows)) {
    const byes = SEASON_BYES[season] ?? [];
    let playoffs;
    try {
      playoffs = derivePlayoffRecords(teams, byes);
    } catch (error) {
      throw new Error(`${season}: ${(error as Error).message}`);
    }
    const bracket = new Map(playoffs.map((row) => [row.franchise_key, row]));

    for (const team of teams) {
      const playoff = bracket.get(team.franchise_key);
      const note = playoff
        ? `${SOURCE}; ${byes.length ? 'divisional bye order, ' : ''}` +
          `${playoff.seed} seed, playoff record derived from the ${PLAYOFF_FIELD}-team bracket`
        : `${SOURCE}; missed the playoffs`;
      results.push({
        season,
        franchise_key: team.franchise_key,
        team_name: team.team_name,
        regular_wins: team.wins,
        regular_losses: team.losses,
        regular_ties: team.ties,
        regular_points_for: team.points_for,
        regular_points_against: team.points_against,
        playoff_wins: playoff?.playoff_wins ?? 0,
        playoff_losses: playoff?.playoff_losses ?? 0,
        final_place: team.final_place,
        is_champion: team.final_place === 1,
        is_runner_up: team.final_place === 2,
        source_note: note,
      });
    }
  }
  return results;
}

export const SEASON_RESULT_COLUMNS = [
  'season', 'franchise_key', 'team_name', 'regular_wins', 'regular_losses',
  'regular_ties', 'regular_points_for', 'regular_points_against', 'playoff_wins',
  'playoff_losses', 'final_place', 'is_champion', 'is_runner_up', 'source_note',
] as const;

export function toSeasonResultsCsv(results: ManualSeasonResult[]): string {
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [SEASON_RESULT_COLUMNS.join(',')];
  for (const row of results) {
    lines.push(SEASON_RESULT_COLUMNS.map((column) => cell(row[column])).join(','));
  }
  return lines.join('\n') + '\n';
}
