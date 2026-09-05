import assert from 'node:assert/strict';
import test from 'node:test';

import type { FranchiseIdMapping } from './espn-archive.ts';
import { attachEspnTeamIds, espnTeamIdForFranchise } from './history-id-map.ts';

const mappings: FranchiseIdMapping[] = [
  { franchise_key: 'bubbs', espn_team_id: 1, start_season: 2005, end_season: null },
  { franchise_key: 'cte-deniers', espn_team_id: 7, start_season: 2005, end_season: 2005 },
  { franchise_key: 'cte-deniers', espn_team_id: 10, start_season: 2006, end_season: null },
];

test('historical franchise ids are season-aware', () => {
  assert.equal(espnTeamIdForFranchise(mappings, 'bubbs', 2005), 1);
  assert.equal(espnTeamIdForFranchise(mappings, 'bubbs', 2026), 1);
  assert.equal(espnTeamIdForFranchise(mappings, 'cte-deniers', 2005), 7);
  assert.equal(espnTeamIdForFranchise(mappings, 'cte-deniers', 2006), 10);
});

test('attaching ids enriches manual rows without changing their record', () => {
  const [row] = attachEspnTeamIds([
    { season: 2005, franchise_key: 'cte-deniers', espn_team_id: null, wins: 8, losses: 4 },
  ], mappings);
  assert.deepEqual(row, {
    season: 2005,
    franchise_key: 'cte-deniers',
    espn_team_id: 7,
    wins: 8,
    losses: 4,
  });
});

test('identity conflicts and missing mappings fail loudly', () => {
  assert.throws(
    () => attachEspnTeamIds([
      { season: 2005, franchise_key: 'cte-deniers', espn_team_id: 10 },
    ], mappings),
    /season file says ESPN team 10, identity ledger says 7/
  );
  assert.throws(
    () => attachEspnTeamIds([
      { season: 2005, franchise_key: 'unknown', espn_team_id: null },
    ], mappings),
    /no ESPN team-id mapping applies/
  );
});
