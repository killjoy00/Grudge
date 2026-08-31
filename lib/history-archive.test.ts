import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  espnManagerSeasons,
  espnSeasonResults,
  franchiseForTeam,
  wasPlayed,
} from './espn-archive.ts';
import type { EspnLeague } from './espn-archive.ts';
import {
  SEASON_BYES,
  buildLeagueHistory,
  groupBySeason,
  parseEspnManagerMap,
  parseFranchiseIdMap,
  parseManagerLabels,
  parseStandings,
  toManagerSeasonsCsv,
  toSeasonResultsCsv,
} from './history-archive.ts';
import { readArchiveFile, readArchiveSources } from './history-files.ts';
import {
  parseFranchises,
  parseManagers,
  parseManagerSeasons,
  parseSeasonResults,
} from './manual-history.ts';
import { derivePlayoffRecords, seedField } from './playoff-bracket.ts';

const standings = parseStandings(readArchiveFile('standings-2005-2017.csv'));
const seasonResults = parseSeasonResults(readArchiveFile('season-results.csv'));
const managerSeasons = parseManagerSeasons(readArchiveFile('manager-seasons.csv'));
const franchises = parseFranchises(readArchiveFile('franchises.csv'));
const managers = parseManagers(readArchiveFile('managers.csv'));
const managerLabels = parseManagerLabels(readArchiveFile('managers.csv'));
const franchiseIds = parseFranchiseIdMap(readArchiveFile('espn-franchises.csv'));
const espnManagerMap = parseEspnManagerMap(readArchiveFile('espn-managers.csv'));

const bySeason = (season: number) => seasonResults.filter((row) => row.season === season);
const allSeasons = [...new Set(seasonResults.map((row) => row.season))].sort();

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

// ------------------------------------------------------------- ESPN archive

const espnLeague = (overrides: Partial<EspnLeague> = {}): EspnLeague => ({
  settings: { scheduleSettings: { matchupPeriodCount: 2 } },
  teams: [
    { id: 1, name: 'A', owners: ['sw-a'], primaryOwner: 'sw-a', rankCalculatedFinal: 1,
      record: { overall: { wins: 2, losses: 0, ties: 0, pointsFor: 200, pointsAgainst: 100 } } },
    { id: 2, name: 'B', owners: ['sw-b'], primaryOwner: 'sw-b', rankCalculatedFinal: 2,
      record: { overall: { wins: 1, losses: 1, ties: 0, pointsFor: 150, pointsAgainst: 150 } } },
  ],
  schedule: [
    { matchupPeriodId: 3, playoffTierType: 'WINNERS_BRACKET', winner: 'HOME',
      home: { teamId: 1 }, away: { teamId: 2 } },
  ],
  ...overrides,
});

const twoTeamMap = [
  { franchise_key: 'alpha', espn_team_id: 1, start_season: 2018, end_season: null },
  { franchise_key: 'beta', espn_team_id: 2, start_season: 2018, end_season: null },
];

test('ESPN playoff records come from the bracket, and byes are not wins', () => {
  const league = espnLeague({
    schedule: [
      // The 1 seed's bye: a matchup with no opponent.
      { matchupPeriodId: 3, playoffTierType: 'WINNERS_BRACKET', winner: 'UNDECIDED',
        home: { teamId: 1 }, away: {} },
      { matchupPeriodId: 4, playoffTierType: 'WINNERS_BRACKET', winner: 'AWAY',
        home: { teamId: 2 }, away: { teamId: 1 } },
      // Consolation games decide placement but are not playoff wins.
      { matchupPeriodId: 4, playoffTierType: 'LOSERS_CONSOLATION_LADDER', winner: 'HOME',
        home: { teamId: 2 }, away: { teamId: 1 } },
    ],
  });
  const rows = espnSeasonResults(league, 2018, twoTeamMap);
  const alpha = rows.find((row) => row.franchise_key === 'alpha')!;
  assert.equal(`${alpha.playoff_wins}-${alpha.playoff_losses}`, '1-0');
  assert.equal(alpha.source, 'espn');
  assert.equal(alpha.espn_team_id, 1);
  assert.ok(alpha.is_champion);
});

test('a season the league never played is skipped, not imported as 0-0', () => {
  const unplayed = espnLeague({
    teams: (espnLeague().teams ?? []).map((team) => ({
      ...team, rankCalculatedFinal: 0,
      record: { overall: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 } },
    })),
  });
  assert.equal(wasPlayed(unplayed), false);
  assert.equal(wasPlayed(espnLeague()), true);
});

test('a bracket winner that ESPN does not rank first is a contradiction', () => {
  const league = espnLeague();
  league.teams![0]!.rankCalculatedFinal = 2;
  league.teams![1]!.rankCalculatedFinal = 1;
  assert.throws(() => espnSeasonResults(league, 2018, twoTeamMap), /won the final/);
});

test('a short regular season is caught rather than silently recorded', () => {
  const league = espnLeague();
  league.teams![0]!.record!.overall!.wins = 5;
  assert.throws(() => espnSeasonResults(league, 2018, twoTeamMap), /regular-season games/);
});

test('a blank mapping drops the co-owner without dropping the team', () => {
  const league = espnLeague();
  league.teams![0]!.owners = ['sw-a', 'sw-ignored'];
  const rows = espnManagerSeasons(league, 2018, twoTeamMap, new Map([
    ['sw-a', 'first'], ['sw-ignored', null], ['sw-b', 'other'],
  ]));
  const alpha = rows.filter((row) => row.franchise_key === 'alpha');
  assert.deepEqual(alpha.map((row) => row.manager_key), ['first']);
  assert.ok(alpha[0]!.is_primary, 'the remaining owner still leads the season');
});

test('an ignored primary owner is an error, not a season with no manager', () => {
  const league = espnLeague();
  league.teams![0]!.owners = ['sw-a', 'sw-ignored'];
  league.teams![0]!.primaryOwner = 'sw-ignored';
  assert.throws(
    () => espnManagerSeasons(league, 2018, twoTeamMap, new Map([
      ['sw-a', 'first'], ['sw-ignored', null], ['sw-b', 'other'],
    ])),
    /primary owners/
  );
});

test('an unmapped ESPN team or account stops the import', () => {
  assert.throws(() => franchiseForTeam(twoTeamMap, 7, 2018), /maps to no franchise/);
  assert.throws(
    () => espnManagerSeasons(espnLeague(), 2018, twoTeamMap, new Map()),
    /maps to no manager/
  );
});

test('co-owners share the season; ESPN primaryOwner settles who leads', () => {
  const league = espnLeague();
  league.teams![0]!.owners = ['sw-a', 'sw-a2'];
  league.teams![0]!.primaryOwner = 'sw-a2';
  const rows = espnManagerSeasons(league, 2018, twoTeamMap, new Map([
    ['sw-a', 'first'], ['sw-a2', 'second'], ['sw-b', 'other'],
  ]));
  const alpha = rows.filter((row) => row.franchise_key === 'alpha');
  assert.equal(alpha.length, 2, 'both owners get the season');
  assert.deepEqual(alpha.filter((row) => row.is_primary).map((row) => row.manager_key), ['second']);
});

// ----------------------------------------------------- the checked-in archive

test('the transcribed era covers 2005-2017 with a complete field every season', () => {
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

test('the generated files are what both eras derive to', () => {
  const history = buildLeagueHistory(readArchiveSources());
  assert.equal(toSeasonResultsCsv(history.seasons), readArchiveFile('season-results.csv'));
  assert.equal(toManagerSeasonsCsv(history.managerSeasons), readArchiveFile('manager-seasons.csv'));
  assert.deepEqual(history.skipped, [2020], 'the league did not play in 2020');
});

test('the record runs 2005 to the present with no gap but 2020', () => {
  const expected = [];
  for (let year = 2005; year <= Math.max(...allSeasons); year++) {
    if (year !== 2020) expected.push(year);
  }
  assert.deepEqual(allSeasons, expected);
  assert.ok(allSeasons.some((year) => year >= 2018), 'the ESPN era is loaded');
});

test('every season is win-loss balanced and has one champion and one runner-up', () => {
  for (const year of allSeasons) {
    const teams = bySeason(year);
    const wins = teams.reduce((sum, row) => sum + row.regular_wins, 0);
    const losses = teams.reduce((sum, row) => sum + row.regular_losses, 0);
    assert.equal(wins, losses, `${year} wins do not match losses`);
    assert.equal(teams.filter((row) => row.is_champion).length, 1, `${year} champions`);
    assert.equal(teams.filter((row) => row.is_runner_up).length, 1, `${year} runners-up`);
    const places = teams.map((row) => row.final_place).sort((a, b) => a! - b!);
    assert.deepEqual(places, teams.map((_, index) => index + 1), `${year} final places`);
  }
});

test('every season is a balanced six-team bracket', () => {
  for (const year of allSeasons) {
    const teams = bySeason(year);
    const wins = teams.reduce((sum, row) => sum + row.playoff_wins, 0);
    const losses = teams.reduce((sum, row) => sum + row.playoff_losses, 0);
    assert.equal(wins, losses, `${year} playoff wins and losses disagree`);
    assert.equal(wins, 5, `${year} played ${wins} playoff games, not 5`);
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

test('every franchise runs unbroken from its first season to its last', () => {
  for (const franchise of franchises) {
    const years = seasonResults
      .filter((row) => row.franchise_key === franchise.franchise_key)
      .map((row) => row.season).sort();
    const expected = allSeasons.filter(
      (year) => year >= years[0]! && year <= years[years.length - 1]!
    );
    assert.deepEqual(years, expected, `${franchise.franchise_key} has a gap`);
    assert.equal(years[0], franchise.founded_season, `${franchise.franchise_key} founded_season`);
  }
});

test('every season has exactly one primary manager', () => {
  const managerKeys = new Set(managers.map((row) => row.manager_key));
  for (const row of managerSeasons) {
    assert.ok(managerKeys.has(row.manager_key), `${row.manager_key} is undeclared`);
  }
  for (const row of seasonResults) {
    const primary = managerSeasons.filter(
      (entry) => entry.season === row.season &&
        entry.franchise_key === row.franchise_key && entry.is_primary
    );
    assert.equal(primary.length, 1, `${row.season} ${row.franchise_key} primary managers`);
  }
});

test('no franchise is left without a manager in any season', () => {
  for (const row of seasonResults) {
    const assigned = managerSeasons.some(
      (entry) => entry.season === row.season && entry.franchise_key === row.franchise_key
    );
    assert.ok(assigned, `${row.season} ${row.franchise_key} has no manager`);
  }
});

test('the manager on each transcribed row matches a name that manager used', () => {
  // Owner labels are the only check on the ledger's tenure ranges. The 2009
  // Silly Nannies row is the one the commissioner overrides outright.
  const known = new Set(['2009:raleigh-silly-nannies']);
  for (const row of standings) {
    if (known.has(`${row.season}:${row.franchise_key}`)) continue;
    const primary = managerSeasons.find(
      (entry) => entry.season === row.season &&
        entry.franchise_key === row.franchise_key && entry.is_primary
    )!;
    const labelled = row.manager_label.split(',').map((name) => name.trim().toLowerCase());
    const known_names = (managerLabels.get(primary.manager_key) ?? [])
      .map((name) => name.toLowerCase());
    assert.ok(
      known_names.some((name) => labelled.includes(name)),
      `${row.season} ${row.franchise_key}: spreadsheet says "${row.manager_label}", ` +
      `${primary.manager_key} answers to ${known_names.join(' / ')}`
    );
  }
});

test('the ESPN identity maps are complete and unambiguous', () => {
  const franchiseKeys = new Set(franchises.map((row) => row.franchise_key));
  const managerKeys = new Set(managers.map((row) => row.manager_key));
  for (const row of franchiseIds) {
    assert.ok(franchiseKeys.has(row.franchise_key), `${row.franchise_key} is undeclared`);
  }
  for (const key of espnManagerMap.values()) {
    // A blank mapping is an account deliberately not credited as a manager.
    if (key === null) continue;
    assert.ok(managerKeys.has(key), `${key} is undeclared`);
  }
  assert.ok(
    [...espnManagerMap.values()].some((key) => key === null),
    'the untracked co-owners are still listed, so a new account fails loudly'
  );
  const ids = franchiseIds.map((row) => row.espn_team_id);
  assert.equal(new Set(ids).size, ids.length, 'an ESPN team id maps to two franchises');
  assert.equal(franchiseIds.length, 10, 'every modern team id has a franchise');
});

test('a franchise keeps one ESPN team id across the modern era', () => {
  const espnRows = seasonResults.filter((row) => row.source === 'espn');
  const ids = new Map<string, Set<number>>();
  for (const row of espnRows) {
    const seen = ids.get(row.franchise_key) ?? new Set<number>();
    seen.add(row.espn_team_id!);
    ids.set(row.franchise_key, seen);
  }
  for (const [key, seen] of ids) {
    assert.equal(seen.size, 1, `${key} changed ESPN team id`);
  }
  assert.equal(ids.size, 10);
});
