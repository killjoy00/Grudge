import assert from 'node:assert/strict';
import test from 'node:test';

import { currentSeasonAliasRepairStatement } from './player-alias-repair.ts';

test('current-season alias fallback only publishes unique exact normalized-name matches', () => {
  const write = currentSeasonAliasRepairStatement(2026);
  assert.deepEqual(write.params, [2026]);
  assert.match(write.text, /left join public\.nfl_player_aliases/);
  assert.match(write.text, /p\.full_name not like 'ESPN player #%'/);
  assert.match(write.text, /having count\(\*\) = 1/);
  assert.match(write.text, /'legacy_exact_name_unique'/);
  assert.match(write.text, /on conflict \(season, espn_player_id\) do nothing/);
});
