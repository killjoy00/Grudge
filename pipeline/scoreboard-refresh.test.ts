import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSameSlate,
  scoreboardRefreshStatements,
} from './scoreboard-refresh-write.ts';
import type { MatchupRow } from './normalize.ts';

const matchup: MatchupRow = {
  season: 2026,
  week: 1,
  espn_matchup_id: 1,
  home_team_id: 4,
  away_team_id: 9,
  home_points: 118.4,
  away_points: 104.1,
  winner: 'HOME',
  playoff_tier: 'NONE',
  is_final: true,
};

test('Monday scoreboard refresh changes scores only', () => {
  const [write] = scoreboardRefreshStatements([matchup]);
  assert.ok(write);
  assert.match(write.text, /set home_points = \$1,\s+away_points = \$2/);
  assert.doesNotMatch(write.text, /winner\s*=/);
  assert.doesNotMatch(write.text, /is_final\s*=/);
  assert.doesNotMatch(write.text, /results_complete/);
  assert.deepEqual(write.params.slice(0, 2), [118.4, 104.1]);
});

test('Monday scoreboard refresh requires the exact stored slate', () => {
  assert.doesNotThrow(() => assertSameSlate(
    [{ espn_matchup_id: 1, home_team_id: 4, away_team_id: 9 }],
    [matchup],
  ));

  assert.throws(() => assertSameSlate(
    [{ espn_matchup_id: 1, home_team_id: 4, away_team_id: 9 }],
    [{ ...matchup, away_team_id: 8 }],
  ), /does not match/);
});
