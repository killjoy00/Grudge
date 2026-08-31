import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCsv,
  expandManagerTenures,
  parseFranchises,
  parseManagerSeasons,
  parseManagerTenures,
  parseSeasonResults,
} from './manual-history.ts';

test('CSV parsing preserves commas and escaped quotes inside quoted values', () => {
  assert.deepEqual(parseCsv('a,b\n"one, two","said ""hi"""\n'), [
    { a: 'one, two', b: 'said "hi"' },
  ]);
});

test('franchise input rejects implicit or duplicate identity mappings', () => {
  assert.throws(
    () => parseFranchises('franchise_key,current_name\nAustin Bubbs,Austin Bubbs\n'),
    /lowercase slug/
  );
  assert.throws(
    () => parseFranchises('franchise_key,current_name\naustin,Austin\naustin,Other\n'),
    /duplicate/
  );
});

test('season results require explicit, internally consistent championships', () => {
  const header = 'season,franchise_key,team_name,regular_wins,regular_losses,regular_ties,regular_points_for,regular_points_against,playoff_wins,playoff_losses,final_place,is_champion,is_runner_up,source_note';
  const rows = parseSeasonResults(`${header}\n2017,silly-nannies,W. Durham Silly Nannies,11,2,0,1500.5,1200.1,2,0,1,yes,no,standings + bracket\n`);
  assert.equal(rows[0]?.is_champion, true);
  assert.equal(rows[0]?.regular_points_for, 1500.5);
  assert.throws(
    () => parseSeasonResults(`${header}\n2017,aa,A,10,3,0,,,2,0,2,yes,no,\n`),
    /champion must finish 1st/
  );
});

test('manager-season input preserves co-owners as separate rows', () => {
  const rows = parseManagerSeasons(
    'season,manager_key,franchise_key,is_primary\n2017,ryan,austin,yes\n2017,byron,austin,no\n'
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.is_primary, false);
});

test('manager join/leave ranges expand only across seasons that franchise played', () => {
  const seasons = parseSeasonResults(
    'season,franchise_key,team_name,regular_wins,regular_losses,regular_ties,regular_points_for,regular_points_against,playoff_wins,playoff_losses,final_place,is_champion,is_runner_up,source_note\n' +
    '2016,austin,Austin,8,5,0,,,0,1,6,no,no,\n' +
    '2017,austin,Austin,9,4,0,,,2,0,1,yes,no,\n'
  );
  const tenures = parseManagerTenures(
    'manager_key,franchise_key,start_season,end_season,is_primary\nryan,austin,2016,,yes\n'
  );
  assert.deepEqual(expandManagerTenures(tenures, seasons).map((row) => row.season), [2016, 2017]);
});
