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

import type { EspnLeague, FranchiseIdMapping } from './espn-archive.ts';
import { espnManagerSeasons, espnSeasonResults, wasPlayed } from './espn-archive.ts';
import { expandManagerTenures, parseCsv, parseManagerTenures } from './manual-history.ts';
import type { ManualManagerSeason, ManualSeasonResult } from './manual-history.ts';
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
        espn_team_id: null,
        source: 'manual',
        source_note: note,
      });
    }
  }
  return results;
}

// ------------------------------------------------------------ both eras

export interface ArchiveSources {
  /** CSV text, in the order the importer's own files appear. */
  standings: string;
  tenures: string;
  franchiseIdMap: string;
  espnManagerMap: string;
  espnLeagues: { season: number; league: EspnLeague }[];
}

export interface LeagueHistory {
  seasons: ManualSeasonResult[];
  managerSeasons: ManualManagerSeason[];
  /** Seasons ESPN created that the league never played -- 2020. */
  skipped: number[];
}

/**
 * Joins the transcribed era to the ESPN era and checks the seam: no season may
 * come from both sources, and a ledger tenure that runs past 2017 has to be the
 * account ESPN shows on that franchise.
 */
export function buildLeagueHistory(sources: ArchiveSources): LeagueHistory {
  const manualSeasons = buildSeasonResults(parseStandings(sources.standings));
  const tenures = parseManagerTenures(sources.tenures);
  const manualManagers = expandManagerTenures(tenures, manualSeasons);

  const franchiseIds = parseFranchiseIdMap(sources.franchiseIdMap);
  const managerBySwid = parseEspnManagerMap(sources.espnManagerMap);

  const espnSeasons: ManualSeasonResult[] = [];
  const espnManagers: ManualManagerSeason[] = [];
  const skipped: number[] = [];

  for (const { season, league } of [...sources.espnLeagues].sort((a, b) => a.season - b.season)) {
    if (!wasPlayed(league)) {
      skipped.push(season);
      continue;
    }
    espnSeasons.push(...espnSeasonResults(league, season, franchiseIds));
    espnManagers.push(...espnManagerSeasons(league, season, franchiseIds, managerBySwid));
  }

  const seen = new Set<string>();
  for (const row of [...manualSeasons, ...espnSeasons]) {
    const key = `${row.season}:${row.franchise_key}`;
    if (seen.has(key)) throw new Error(`${key} appears in both eras; the sources overlap.`);
    seen.add(key);
  }

  if (espnSeasons.length) {
    const firstEspn = Math.min(...espnSeasons.map((row) => row.season));
    for (const tenure of tenures) {
      if (tenure.end_season !== null) continue;
      const owners = espnManagers.filter(
        (row) => row.season === firstEspn && row.franchise_key === tenure.franchise_key
      );
      if (owners.length && !owners.some((row) => row.manager_key === tenure.manager_key)) {
        throw new Error(
          `${tenure.manager_key} still runs ${tenure.franchise_key} in the ledger, but the ` +
          `${firstEspn} ESPN owners are ${owners.map((row) => row.manager_key).join(', ')}. ` +
          'Close the tenure or fix espn-managers.csv.'
        );
      }
    }
  }

  return {
    seasons: sortSeasonResults([...manualSeasons, ...espnSeasons]),
    managerSeasons: sortManagerSeasons([...manualManagers, ...espnManagers]),
    skipped,
  };
}

// --------------------------------------------------------- identity mapping

/** Ties an ESPN team id to a franchise, and an ESPN account to a person. */
export function parseFranchiseIdMap(text: string): FranchiseIdMapping[] {
  return parseCsv(text).map((row, index) => {
    const line = index + 2;
    const int = (column: string, optional = false) => {
      const raw = row[column]?.trim() ?? '';
      if (!raw && optional) return null;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed)) throw new Error(`Row ${line}: ${column} must be an integer.`);
      return parsed;
    };
    const mapping: FranchiseIdMapping = {
      franchise_key: row.franchise_key?.trim() ?? '',
      espn_team_id: int('espn_team_id')!,
      start_season: int('start_season')!,
      end_season: int('end_season', true),
    };
    if (!mapping.franchise_key) throw new Error(`Row ${line}: franchise_key is required.`);
    return mapping;
  });
}

/**
 * ESPN account to person. A blank manager_key means the account is deliberately
 * not tracked as a manager -- a co-owner the league does not credit -- and is
 * skipped rather than dropping the team or inventing a record. An account
 * missing from the file entirely is still an error, so a new owner cannot slip
 * in unnoticed.
 */
export function parseEspnManagerMap(text: string): Map<string, string | null> {
  const map = new Map<string, string | null>();
  parseCsv(text).forEach((row, index) => {
    const line = index + 2;
    const swid = row.swid?.trim();
    if (!swid) throw new Error(`Row ${line}: swid is required.`);
    if (map.has(swid)) throw new Error(`Row ${line}: duplicate ESPN account ${swid}.`);
    map.set(swid, row.manager_key?.trim() || null);
  });
  return map;
}

/**
 * Owner labels a manager appeared under in the spreadsheets, so a rename does
 * not read as a different person. Semicolon-separated, matched case-insensitively.
 */
export function parseManagerLabels(text: string): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  for (const row of parseCsv(text)) {
    const key = row.manager_key?.trim();
    if (!key) continue;
    const extra = (row.archive_labels ?? '').split(';').map((name) => name.trim()).filter(Boolean);
    labels.set(key, [row.display_name?.trim() ?? '', ...extra].filter(Boolean));
  }
  return labels;
}

// ------------------------------------------------------------------ writers

export const SEASON_RESULT_COLUMNS = [
  'season', 'franchise_key', 'team_name', 'espn_team_id', 'regular_wins',
  'regular_losses', 'regular_ties', 'regular_points_for', 'regular_points_against',
  'playoff_wins', 'playoff_losses', 'final_place', 'is_champion', 'is_runner_up',
  'source', 'source_note',
] as const;

export const MANAGER_SEASON_COLUMNS = [
  'season', 'manager_key', 'franchise_key', 'is_primary',
] as const;

function cell(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(columns: readonly string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(','));
  return lines.join('\n') + '\n';
}

export function toSeasonResultsCsv(results: ManualSeasonResult[]): string {
  return toCsv(SEASON_RESULT_COLUMNS, results as unknown as Record<string, unknown>[]);
}

export function toManagerSeasonsCsv(rows: ManualManagerSeason[]): string {
  return toCsv(MANAGER_SEASON_COLUMNS, rows as unknown as Record<string, unknown>[]);
}

/** Season, then finish, so a diff of the generated file reads like a table. */
export function sortSeasonResults(rows: ManualSeasonResult[]): ManualSeasonResult[] {
  return [...rows].sort(
    (a, b) => a.season - b.season ||
      (a.final_place ?? 99) - (b.final_place ?? 99) ||
      a.franchise_key.localeCompare(b.franchise_key)
  );
}

export function sortManagerSeasons(rows: ManualManagerSeason[]): ManualManagerSeason[] {
  return [...rows].sort(
    (a, b) => a.season - b.season ||
      a.franchise_key.localeCompare(b.franchise_key) ||
      Number(b.is_primary) - Number(a.is_primary) ||
      a.manager_key.localeCompare(b.manager_key)
  );
}
