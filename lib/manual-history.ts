/** Pure parsing and validation for the human-recovered league archive. */

export type CsvRecord = Record<string, string>;

export function parseCsv(text: string): CsvRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n') {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted value.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0]!.map((value) => value.trim());
  if (headers.some((header) => !header)) throw new Error('CSV has an empty header.');
  if (new Set(headers).size !== headers.length) throw new Error('CSV has duplicate headers.');

  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
  });
}

function required(row: CsvRecord, key: string, line: number): string {
  const value = row[key]?.trim();
  if (!value) throw new Error(`Row ${line}: ${key} is required.`);
  return value;
}

function integer(value: string, key: string, line: number, optional = false): number | null {
  if (!value.trim() && optional) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Row ${line}: ${key} must be an integer.`);
  return parsed;
}

function decimal(value: string, key: string, line: number): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Row ${line}: ${key} must be a number.`);
  return parsed;
}

function boolean(value: string, key: string, line: number): boolean {
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', '1'].includes(normalized)) return true;
  if (['false', 'no', '0', ''].includes(normalized)) return false;
  throw new Error(`Row ${line}: ${key} must be yes or no.`);
}

function key(value: string, label: string, line: number) {
  if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(value)) {
    throw new Error(`Row ${line}: ${label} must be a lowercase slug such as austin-bubbs.`);
  }
  return value;
}

export interface ManualFranchise {
  franchise_key: string;
  current_name: string;
  founded_season: number | null;
  folded_season: number | null;
  notes: string | null;
}

export function parseFranchises(text: string): ManualFranchise[] {
  const seen = new Set<string>();
  return parseCsv(text).map((row, index) => {
    const line = index + 2;
    const franchiseKey = key(required(row, 'franchise_key', line), 'franchise_key', line);
    if (seen.has(franchiseKey)) throw new Error(`Row ${line}: duplicate franchise_key ${franchiseKey}.`);
    seen.add(franchiseKey);
    const founded = integer(row.founded_season ?? '', 'founded_season', line, true);
    const folded = integer(row.folded_season ?? '', 'folded_season', line, true);
    if (founded !== null && folded !== null && folded < founded) {
      throw new Error(`Row ${line}: folded_season is before founded_season.`);
    }
    return {
      franchise_key: franchiseKey,
      current_name: required(row, 'current_name', line),
      founded_season: founded,
      folded_season: folded,
      notes: row.notes?.trim() || null,
    };
  });
}

export interface ManualSeasonResult {
  season: number;
  franchise_key: string;
  team_name: string;
  regular_wins: number;
  regular_losses: number;
  regular_ties: number;
  regular_points_for: number | null;
  regular_points_against: number | null;
  playoff_wins: number;
  playoff_losses: number;
  final_place: number | null;
  is_champion: boolean;
  is_runner_up: boolean;
  source_note: string | null;
}

export function parseSeasonResults(text: string): ManualSeasonResult[] {
  const seen = new Set<string>();
  return parseCsv(text).map((row, index) => {
    const line = index + 2;
    const season = integer(required(row, 'season', line), 'season', line)!;
    if (season < 1900 || season > 2100) throw new Error(`Row ${line}: season is out of range.`);
    const franchiseKey = key(required(row, 'franchise_key', line), 'franchise_key', line);
    const compound = `${season}:${franchiseKey}`;
    if (seen.has(compound)) throw new Error(`Row ${line}: duplicate season/franchise.`);
    seen.add(compound);

    const finalPlace = integer(row.final_place ?? '', 'final_place', line, true);
    const champion = boolean(row.is_champion ?? '', 'is_champion', line);
    const runnerUp = boolean(row.is_runner_up ?? '', 'is_runner_up', line);
    if (champion && finalPlace !== 1) throw new Error(`Row ${line}: a champion must finish 1st.`);
    if (runnerUp && finalPlace !== 2) throw new Error(`Row ${line}: a runner-up must finish 2nd.`);
    if (champion && runnerUp) throw new Error(`Row ${line}: a team cannot be champion and runner-up.`);

    const nonnegative = (column: string) => {
      const value = integer(row[column] ?? '0', column, line)!;
      if (value < 0) throw new Error(`Row ${line}: ${column} cannot be negative.`);
      return value;
    };
    return {
      season,
      franchise_key: franchiseKey,
      team_name: required(row, 'team_name', line),
      regular_wins: nonnegative('regular_wins'),
      regular_losses: nonnegative('regular_losses'),
      regular_ties: nonnegative('regular_ties'),
      regular_points_for: decimal(row.regular_points_for ?? '', 'regular_points_for', line),
      regular_points_against: decimal(row.regular_points_against ?? '', 'regular_points_against', line),
      playoff_wins: nonnegative('playoff_wins'),
      playoff_losses: nonnegative('playoff_losses'),
      final_place: finalPlace,
      is_champion: champion,
      is_runner_up: runnerUp,
      source_note: row.source_note?.trim() || null,
    };
  });
}

export interface ManualManager {
  manager_key: string;
  display_name: string;
  notes: string | null;
}

export function parseManagers(text: string): ManualManager[] {
  const seen = new Set<string>();
  return parseCsv(text).map((row, index) => {
    const line = index + 2;
    const managerKey = key(required(row, 'manager_key', line), 'manager_key', line);
    if (seen.has(managerKey)) throw new Error(`Row ${line}: duplicate manager_key ${managerKey}.`);
    seen.add(managerKey);
    return {
      manager_key: managerKey,
      display_name: required(row, 'display_name', line),
      notes: row.notes?.trim() || null,
    };
  });
}

export interface ManualManagerSeason {
  season: number;
  manager_key: string;
  franchise_key: string;
  is_primary: boolean;
}

export function parseManagerSeasons(text: string): ManualManagerSeason[] {
  const seen = new Set<string>();
  return parseCsv(text).map((row, index) => {
    const line = index + 2;
    const result = {
      season: integer(required(row, 'season', line), 'season', line)!,
      manager_key: key(required(row, 'manager_key', line), 'manager_key', line),
      franchise_key: key(required(row, 'franchise_key', line), 'franchise_key', line),
      is_primary: boolean(row.is_primary ?? 'yes', 'is_primary', line),
    };
    const compound = `${result.season}:${result.manager_key}:${result.franchise_key}`;
    if (seen.has(compound)) throw new Error(`Row ${line}: duplicate manager/franchise season.`);
    seen.add(compound);
    return result;
  });
}

export interface ManualManagerTenure {
  manager_key: string;
  franchise_key: string;
  start_season: number;
  end_season: number | null;
  is_primary: boolean;
}

/** Compact human input: one joined/left range expands to explicit season rows. */
export function parseManagerTenures(text: string): ManualManagerTenure[] {
  return parseCsv(text).map((row, index) => {
    const line = index + 2;
    const start = integer(required(row, 'start_season', line), 'start_season', line)!;
    const end = integer(row.end_season ?? '', 'end_season', line, true);
    if (end !== null && end < start) {
      throw new Error(`Row ${line}: end_season is before start_season.`);
    }
    return {
      manager_key: key(required(row, 'manager_key', line), 'manager_key', line),
      franchise_key: key(required(row, 'franchise_key', line), 'franchise_key', line),
      start_season: start,
      end_season: end,
      is_primary: boolean(row.is_primary ?? 'yes', 'is_primary', line),
    };
  });
}

export function expandManagerTenures(
  tenures: ManualManagerTenure[],
  seasonResults: ManualSeasonResult[]
): ManualManagerSeason[] {
  const available = new Set(
    seasonResults.map((row) => `${row.season}:${row.franchise_key}`)
  );
  const maximum = seasonResults.length
    ? Math.max(...seasonResults.map((row) => row.season))
    : 0;
  const expanded: ManualManagerSeason[] = [];
  const seen = new Set<string>();

  for (const tenure of tenures) {
    const end = tenure.end_season ?? maximum;
    for (let season = tenure.start_season; season <= end; season++) {
      const franchiseSeason = `${season}:${tenure.franchise_key}`;
      if (!available.has(franchiseSeason)) continue;
      const compound = `${season}:${tenure.manager_key}:${tenure.franchise_key}`;
      if (seen.has(compound)) throw new Error(`Overlapping manager tenure: ${compound}.`);
      seen.add(compound);
      expanded.push({
        season,
        manager_key: tenure.manager_key,
        franchise_key: tenure.franchise_key,
        is_primary: tenure.is_primary,
      });
    }
  }
  return expanded;
}
