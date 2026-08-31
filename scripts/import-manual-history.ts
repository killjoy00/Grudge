#!/usr/bin/env -S npx tsx

import { readFileSync } from 'node:fs';

import {
  parseFranchises,
  expandManagerTenures,
  parseManagers,
  parseManagerTenures,
  parseSeasonResults,
} from '../lib/manual-history.ts';
import { connect, runTransaction, upsert } from '../pipeline/db.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const franchiseFile = value('franchises');
const seasonFile = value('seasons');
const managerFile = value('managers');
const tenureFile = value('tenures');

if (!franchiseFile || !seasonFile) {
  throw new Error(
    'Usage: npm run history:import -- --franchises=franchises.csv --seasons=season-results.csv ' +
    '[--managers=managers.csv --tenures=manager-tenures.csv] [--dry-run]'
  );
}
if (Boolean(managerFile) !== Boolean(tenureFile)) {
  throw new Error('--managers and --tenures must be supplied together.');
}

const franchises = parseFranchises(readFileSync(franchiseFile, 'utf8'));
const seasons = parseSeasonResults(readFileSync(seasonFile, 'utf8'));
const managers = managerFile ? parseManagers(readFileSync(managerFile, 'utf8')) : [];
const tenures = tenureFile ? parseManagerTenures(readFileSync(tenureFile, 'utf8')) : [];
const managerSeasons = expandManagerTenures(tenures, seasons);

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
    throw new Error(`${row.season} ${row.franchise_key}: manager assignment has no season result.`);
  }
}

console.log(
  `Validated ${franchises.length} franchises, ${seasons.length} season results, ` +
  `${managers.length} managers, and ${managerSeasons.length} manager assignments.`
);
if (dryRun) {
  console.log('Dry run: database unchanged.');
  process.exit(0);
}

const statements = [
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
    'public.franchise_seasons',
    [
      'season', 'franchise_key', 'team_name', 'regular_wins', 'regular_losses',
      'regular_ties', 'regular_points_for', 'regular_points_against',
      'playoff_wins', 'playoff_losses', 'final_place', 'is_champion',
      'is_runner_up', 'source', 'source_note',
    ],
    seasons.map((row) => ({ ...row, source: 'manual' })),
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
console.log('Manual history imported in one transaction.');
