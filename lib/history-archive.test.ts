import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  SEASON_BYES,
  buildSeasonResults,
  groupBySeason,
  parseStandings,
  toSeasonResultsCsv,
} from './history-archive.ts';
import {
  expandManagerTenures,
  parseFranchises,
  parseManagers,
  parseManagerTenures,
  parseSeasonResults,
} from './manual-history.ts';
import { derivePlayoffRecords, seedField } from './playoff-bracket.ts';

const archive = (name: string) =>
  readFileSync(new URL(`../data/manual-history/${name}`, import.meta.url), 'utf8');

const standings = parseStandings(archive('standings-2005-2017.csv'));
const seasonResults = parseSeasonResults(archive('season-results.csv'));
const franchises = parseFranchises(archive('franchises.csv'));
const managers = parseManagers(archive('managers.csv'));
const tenures = parseManagerTenures(archive('manager-tenures.csv'));

// ------------------------------------------------------------- bracket model

/** A 2017-shaped season: 13 games, six qualifiers, byes from the standings. */
function season(entries: [key: string, wins: number, pointsFor: number, place: number][]) {
  return entries.map(([franchise_key, wins, points_for, final_place]) => ({
    franchise_key, wins, losses: 13 - wins, ties: 0, points_for, final_place,
  }));
}

test('seeds by win percentage, breaking ties on points for', () => {
  const seeds = seedField(season([
    ['a', 9, 1000, 1], ['b', 8, 1200, 2], ['c', 8, 1100, 3],
    ['d', 7, 1000, 4], ['e', 7, 900, 5], ['f', 6, 800, 6],
  ])).map((team) => team.franchise_key);
  assert.deepEqual(seeds, ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('a named bye moves a team ahead of better records', () => {
  const seeds = seedField(season([
    ['a', 9, 1000, 1], ['b', 8, 1200, 2], ['c', 8, 1100, 3],
    ['d', 7, 1000, 4], ['e', 7, 900, 5], ['f', 6, 800, 6],
  ]), ['a', 'd']).map((team) => team.franchise_key);
  assert.deepEqual(seeds, ['a', 'd', 'b', 'c', 'e', 'f']);
});

test('a bye is worth a game: the top seed wins the title in two', () => {
  // Finish order 1..6 assigned so the top seed wins it all.
  const records = derivePlayoffRecords(season([
    ['a', 9, 1000, 1], ['b', 8, 1200, 2], ['c', 8, 1100, 3],
    ['d', 7, 1000, 4], ['e', 7, 900, 5], ['f', 6, 800, 6],
  ]));
  const record = (key: string) => {
    const row = records.find((entry) => entry.franchise_key === key)!;
    return `${row.playoff_wins}-${row.playoff_losses}`;
  };
  assert.equal(record('a'), '2-0', 'champion with a bye plays two games');
  assert.equal(record('b'), '1-1', 'runner-up with a bye');
  assert.equal(record('c'), '1-1', 'semifinal losers won their first-round game');
  assert.equal(record('d'), '1-1');
  assert.equal(record('e'), '0-1', 'first-round losers never won a game');
  assert.equal(record('f'), '0-1');
});

test('a finish order the bracket cannot produce is rejected, not guessed', () => {
  // The 2006 shape: the joint-best record loses in the first round, which is
  // impossible when the two best records take the byes.
  const teams = season([
    ['best', 9, 1272, 3], ['tied', 9, 1131, 6], ['second', 8, 1306, 2],
    ['champ', 7, 1154, 1], ['fifth', 7, 1126, 5], ['sixth', 6, 1108, 4],
  ]);
  assert.throws(() => derivePlayoffRecords(teams), /does not fit the bracket/);
  // Naming the division winners resolves it.
  const records = derivePlayoffRecords(teams, ['best', 'second']);
  const champ = records.find((row) => row.franchise_key === 'champ')!;
  assert.equal(`${champ.playoff_wins}-${champ.playoff_losses}`, '3-0');
});

test('a playoff finish without a top-six record is rejected', () => {
  assert.throws(() => seedField([
    ...season([
      ['a', 9, 1000, 1], ['b', 8, 1200, 2], ['c', 8, 1100, 3],
      ['d', 7, 1000, 4], ['e', 7, 900, 5], ['f', 2, 500, 6],
    ]),
    ...season([['g', 7, 950, 7]]),
  ]), /without a top-6 record/);
});

// ----------------------------------------------------- the checked-in archive

test('the archive covers 2005-2017 with a complete field every season', () => {
  const seasons = groupBySeason(standings);
  assert.deepEqual([...seasons.keys()].sort(), [
    2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017,
  ]);
  for (const [year, teams] of seasons) {
    assert.equal(teams.length, year === 2005 ? 8 : 10, `${year} team count`);
    const games = new Set(teams.map((team) => team.wins + team.losses + team.ties));
    assert.equal(games.size, 1, `${year} teams played different numbers of games`);
    assert.equal([...games][0], year === 2005 ? 12 : 13, `${year} schedule length`);
  }
});

test('every season is win-loss balanced', () => {
  for (const [year, teams] of groupBySeason(standings)) {
    const wins = teams.reduce((sum, team) => sum + team.wins, 0);
    const losses = teams.reduce((sum, team) => sum + team.losses, 0);
    assert.equal(wins, losses, `${year} wins do not match losses`);
  }
});

test('season-results.csv is what the standings derive to', () => {
  assert.equal(toSeasonResultsCsv(buildSeasonResults(standings)), archive('season-results.csv'));
});

test('each season has one champion, one runner-up, and a balanced bracket', () => {
  for (const year of new Set(seasonResults.map((row) => row.season))) {
    const teams = seasonResults.filter((row) => row.season === year);
    assert.equal(teams.filter((row) => row.is_champion).length, 1, `${year} champions`);
    assert.equal(teams.filter((row) => row.is_runner_up).length, 1, `${year} runners-up`);
    const wins = teams.reduce((sum, row) => sum + row.playoff_wins, 0);
    const losses = teams.reduce((sum, row) => sum + row.playoff_losses, 0);
    assert.equal(wins, 5, `${year} playoff games won`);
    assert.equal(losses, 5, `${year} playoff games lost`);
    assert.equal(
      teams.filter((row) => row.playoff_wins + row.playoff_losses > 0).length, 6,
      `${year} qualifiers`
    );
  }
});

test('only 2006 needs its byes named', () => {
  assert.deepEqual(Object.keys(SEASON_BYES), ['2006']);
});

// ------------------------------------------------------------------ identity

test('every season row belongs to a declared franchise', () => {
  const keys = new Set(franchises.map((row) => row.franchise_key));
  for (const row of seasonResults) {
    assert.ok(keys.has(row.franchise_key), `${row.season} ${row.franchise_key} is undeclared`);
  }
  assert.equal(keys.size, 10);
});

test('every archived season has exactly one primary manager', () => {
  const managerKeys = new Set(managers.map((row) => row.manager_key));
  const assignments = expandManagerTenures(tenures, seasonResults);
  for (const row of assignments) {
    assert.ok(managerKeys.has(row.manager_key), `${row.manager_key} is undeclared`);
  }
  for (const row of seasonResults) {
    const primary = assignments.filter(
      (entry) => entry.season === row.season &&
        entry.franchise_key === row.franchise_key && entry.is_primary
    );
    assert.equal(primary.length, 1, `${row.season} ${row.franchise_key} primary managers`);
  }
});

test('the manager on each row matches the name the spreadsheet recorded', () => {
  // The archive's owner labels are the only check on the tenure ranges. Two
  // rows are known to differ: co-ownership, and the 2009 Silly Nannies handover.
  const known = new Set(['2009:raleigh-silly-nannies']);
  const displayName = new Map(managers.map((row) => [row.manager_key, row.display_name]));
  const assignments = expandManagerTenures(tenures, seasonResults);
  for (const row of standings) {
    if (known.has(`${row.season}:${row.franchise_key}`)) continue;
    const primary = assignments.find(
      (entry) => entry.season === row.season &&
        entry.franchise_key === row.franchise_key && entry.is_primary
    )!;
    const labelled = row.manager_label.split(',').map((name) => name.trim());
    assert.ok(
      labelled.includes(displayName.get(primary.manager_key)!),
      `${row.season} ${row.franchise_key}: spreadsheet says "${row.manager_label}", ` +
      `tenures say ${displayName.get(primary.manager_key)}`
    );
  }
});
