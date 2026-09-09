#!/usr/bin/env -S npx tsx

import { readFileSync } from 'node:fs';

import {
  parseFranchises,
  expandManagerTenures,
  parseManagers,
  parseManagerSeasons,
  parseManagerTenures,
  parseSeasonResults,
} from '../lib/manual-history.ts';
import { parseFranchiseIdMap } from '../lib/history-archive.ts';
import { attachEspnTeamIds } from '../lib/history-id-map.ts';
import { historyImportPruneStatements } from '../lib/history-import.ts';
import { connect, runTransaction, upsert } from '../pipeline/db.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const franchiseFile = value('franchises');
const seasonFile = value('seasons');
const managerFile = value('managers');
const tenureFile = value('tenures');
const managerSeasonFile = value('manager-seasons');
const espnFranchiseFile = value('espn-franchises');

if (!franchiseFile || !seasonFile) {
  throw new Error(
    'Usage: npm run history:import -- --franchises=franchises.csv --seasons=season-results.csv ' +
    '[--espn-franchises=espn-franchises.csv] ' +
    '[--managers=managers.csv (--manager-seasons=manager-seasons.csv | --tenures=manager-tenures.csv)] ' +
    '[--dry-run]'
  );
}
if (tenureFile && managerSeasonFile) {
  throw new Error('Supply either --manager-seasons or --tenures, not both.');
}
const assignmentFile = managerSeasonFile ?? tenureFile;
if (Boolean(managerFile) !== Boolean(assignmentFile)) {
  throw new Error('--managers needs --manager-seasons (or --tenures), and vice versa.');
}

const franchises = parseFranchises(readFileSync(franchiseFile, 'utf8'));
let seasons = parseSeasonResults(readFileSync(seasonFile, 'utf8'));
if (espnFranchiseFile) {
  const mappings = parseFranchiseIdMap(readFileSync(espnFranchiseFile, 'utf8'));
  seasons = attachEspnTeamIds(seasons, mappings);
}
const managers = managerFile ? parseManagers(readFileSync(managerFile, 'utf8')) : [];
const managerSeasons = managerSeasonFile
  ? parseManagerSeasons(readFileSync(managerSeasonFile, 'utf8'))
  : tenureFile
    ? expandManagerTenures(parseManagerTenures(readFileSync(tenureFile, 'utf8')), seasons)
    : [];

const franchiseKeys = new Set(franchises.map((row) => row.franchise_key));
for (const row of seasons) {
  if (!franchiseKeys.has(row.franchise_key)) {
    throw new Error(`${row.season} ${row.franchise_key}: franchise is missing from the franchise file.`);
  }
}
const managerKeys = new Set(managers.map((row) => row.manager_key));
const seasonKeys = new Set(seasons.map((row) => `${row.season}:${row.franchise_key}`));
for (const row of managerSeasons) {
  if (!managerKeys.has(row.manager_key)) {
    throw new Error(`${row.manager_key}: manager is missing from the manager file.`);
  }
  if (!seasonKeys.has(`${row.season}:${row.franchise_key}`)) {
    throw new Error(`${row.season} ${row.franchise_key}: manager assignment has no franchise-season identity.`);
  }
}

const years = seasons.map((row) => row.season);
const mappedIds = seasons.filter((row) => row.espn_team_id !== null).length;
console.log(
  `Validated ${franchises.length} franchises, ${seasons.length} season results ` +
  `(${Math.min(...years)}-${Math.max(...years)}; ${mappedIds} with ESPN ids), ${managers.length} managers, ` +
  `and ${managerSeasons.length} manager assignments.`
);
if (dryRun) {
  console.log('Dry run: database unchanged.');
  process.exit(0);
}

// Historical manager-season attribution is authoritative, but manager identities
// themselves are durable and may be referenced by provider crosswalks.
const prune = historyImportPruneStatements(managers.length > 0, managerSeasons.length > 0);

const seasonTeams = seasons.map(({ season, franchise_key, team_name, espn_team_id }) => ({
  season, franchise_key, team_name, espn_team_id,
}));
const seasonResults = seasons.map(({
  team_name: _teamName, espn_team_id: _espnTeamId, ...result
}) => result);

const statements = [
  ...prune,
  upsert(
    'public.franchises',
    ['franchise_key', 'current_name', 'founded_season', 'folded_season', 'notes'],
    franchises,
    ['franchise_key']
  ),
  upsert(
    'public.managers',
    ['manager_key', 'display_name', 'notes'],
    managers,
    ['manager_key']
  ),
  upsert(
    'public.franchise_season_teams',
    ['season', 'franchise_key', 'team_name', 'espn_team_id'],
    seasonTeams,
    ['season', 'franchise_key']
  ),
  upsert(
    'public.franchise_season_results',
    [
      'season', 'franchise_key', 'regular_wins', 'regular_losses', 'regular_ties',
      'regular_points_for', 'regular_points_against', 'playoff_wins', 'playoff_losses',
      'final_place', 'is_champion', 'is_runner_up', 'source', 'source_note',
    ],
    seasonResults,
    ['season', 'franchise_key']
  ),
  upsert(
    'public.manager_franchise_seasons',
    ['season', 'manager_key', 'franchise_key', 'is_primary'],
    managerSeasons,
    ['season', 'manager_key', 'franchise_key']
  ),
].filter((statement) => statement !== null);

await runTransaction(connect(), statements);
console.log('League history identities and results imported in one transaction.');
